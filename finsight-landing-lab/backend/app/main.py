from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import get_current_user
from .calculations import calculate_ratios
from .config import Settings, get_settings
from .normalization import (
    CsvValidationError,
    ParsedCsv,
    discover_fields,
    extract_company_name,
    normalize_csv_rows,
    parse_csv_content,
)
from .persistence import SupabaseRepository


class UploadView(BaseModel):
    id: str
    filename: str
    status: str
    row_count: int | None = None
    column_count: int | None = None
    file_size_bytes: int
    created_at: str | None = None
    completed_at: str | None = None
    mapping_review_count: int = 0
    error_message: str | None = None
    company_name: str | None = None


class RatioView(BaseModel):
    period: str | None = None
    company_name: str | None = None
    ratio_identifier: str
    calculated_value: float | None = None
    unit: str
    calculation_status: str
    formula_version: str
    calculated_at: str
    input_values: list[dict[str, Any]]
    reason: str | None = None


class UploadResponse(BaseModel):
    upload: UploadView
    ratios: list[RatioView]
    discovered_fields: list[dict[str, Any]]


class UploadStatusResponse(BaseModel):
    upload: UploadView
    ratios: list[RatioView]
    discovered_fields: list[dict[str, Any]]


def get_repository(settings: Settings = Depends(get_settings)) -> SupabaseRepository:
    try:
        return SupabaseRepository(settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Backend Supabase configuration is incomplete.") from exc


settings = get_settings()
app = FastAPI(title="FinSight Financial Ingestion API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _upload_view(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: record.get(key)
        for key in (
            "id", "filename", "status", "row_count", "column_count", "file_size_bytes",
            "created_at", "completed_at", "mapping_review_count", "error_message", "company_name",
        )
    }


def _raw_row_records(parsed: ParsedCsv, upload_id: str, user_id: str) -> list[dict[str, Any]]:
    return [
        {
            "source_upload_id": upload_id,
            "user_id": user_id,
            "row_number": row_number,
            # Keeping the original header array beside each value array preserves duplicate headers.
            "raw_data": {"columns": parsed.headers, "values": row},
        }
        for row_number, row in enumerate(parsed.rows, start=2)
    ]


def _process_upload(
    repository: SupabaseRepository,
    settings: Settings,
    user_id: str,
    upload_id: str,
    filename: str,
    content: bytes,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    storage_path = f"{user_id}/{upload_id}/original.csv"
    repository.upload_original(storage_path, content)
    repository.update_upload(upload_id, user_id, {"storage_path": storage_path})

    parsed = parse_csv_content(filename, content, settings.max_rows, settings.max_columns)
    # Persist every source row before field discovery or canonical interpretation.
    raw_rows = _raw_row_records(parsed, upload_id, user_id)
    repository.insert_raw_rows(raw_rows)
    discovered_fields = discover_fields(parsed.headers, parsed.rows)
    repository.insert_discovered_fields([
        {**field, "source_upload_id": upload_id, "user_id": user_id}
        for field in discovered_fields
    ])
    company_name = extract_company_name(parsed.headers, parsed.rows)
    financial_lines = [
        {**line, "source_upload_id": upload_id, "user_id": user_id}
        for line in normalize_csv_rows(parsed.headers, parsed.rows, filename, discovered_fields)
    ]
    mapping_review_count = sum(
        line["mapping_status"] in {"unmapped", "ambiguous", "invalid", "missing"}
        for line in financial_lines
    )
    ratios = calculate_ratios(financial_lines, upload_id, user_id, company_name)
    completed_at = datetime.now(timezone.utc).isoformat()
    status = "needs_review" if mapping_review_count else "completed"

    repository.insert_financial_lines(financial_lines)
    repository.insert_ratio_results(ratios)
    repository.update_upload(upload_id, user_id, {
        "status": status,
        "row_count": len(parsed.rows),
        "column_count": len(parsed.headers),
        "mapping_review_count": mapping_review_count,
        "company_name": company_name,
        "encoding": parsed.encoding,
        "completed_at": completed_at,
        "error_message": None,
    })
    return {
        "id": upload_id,
        "filename": filename,
        "status": status,
        "row_count": len(parsed.rows),
        "column_count": len(parsed.headers),
        "file_size_bytes": len(content),
        "created_at": None,
        "completed_at": completed_at,
        "mapping_review_count": mapping_review_count,
        "error_message": None,
        "company_name": company_name,
    }, ratios, discovered_fields


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/uploads", response_model=list[UploadView])
def list_uploads(
    user: dict[str, Any] = Depends(get_current_user),
    repository: SupabaseRepository = Depends(get_repository),
) -> list[dict[str, Any]]:
    uploads = repository.list_owned_uploads(str(user["id"]))
    return [_upload_view(upload) for upload in uploads]


@app.post("/uploads", response_model=UploadResponse, status_code=201)
def upload_csv(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
    repository: SupabaseRepository = Depends(get_repository),
    app_settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    filename = Path(file.filename or "upload.csv").name
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Upload a .csv file.")
    content = file.file.read(app_settings.max_upload_bytes + 1)
    if len(content) > app_settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"The CSV exceeds the {app_settings.max_upload_bytes // (1024 * 1024)} MB upload limit.")
    if not content:
        raise HTTPException(status_code=422, detail="The CSV file is empty.")

    upload_id = str(uuid4())
    user_id = str(user["id"])
    record = {
        "id": upload_id,
        "user_id": user_id,
        "filename": filename,
        "status": "processing",
        "file_size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "storage_bucket": app_settings.storage_bucket,
    }
    repository.create_upload(record)

    try:
        upload_view, ratios, discovered_fields = _process_upload(
            repository, app_settings, user_id, upload_id, filename, content,
        )
    except CsvValidationError as exc:
        repository.update_upload(upload_id, user_id, {
            "status": "failed",
            "error_message": str(exc),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        # Keep provider/DB exception details out of responses; they may contain sensitive config.
        try:
            repository.update_upload(upload_id, user_id, {
                "status": "failed",
                "error_message": "Processing failed. Check backend configuration and migration status.",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"The upload could not be processed. Reference: {upload_id}",
        ) from exc
    return {"upload": upload_view, "ratios": ratios, "discovered_fields": discovered_fields}


@app.get("/uploads/{upload_id}", response_model=UploadStatusResponse)
def get_upload_status(
    upload_id: UUID,
    user: dict[str, Any] = Depends(get_current_user),
    repository: SupabaseRepository = Depends(get_repository),
) -> dict[str, Any]:
    user_id = str(user["id"])
    upload = repository.get_owned_upload(str(upload_id), user_id)
    if upload is None:
        # Do not disclose whether another user's upload ID exists.
        raise HTTPException(status_code=404, detail="Upload not found.")
    return {
        "upload": _upload_view(upload),
        "ratios": repository.get_owned_ratios(str(upload_id), user_id),
        "discovered_fields": repository.get_owned_discovered_fields(str(upload_id), user_id),
    }
