from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.auth as auth_module
import app.main as main_module
from app.auth import get_current_user, verify_access_token
from app.config import Settings, get_settings
from app.main import app, get_repository


USER_ID = "4a9909ad-a0ba-4d78-9b25-a1c20e9c17b0"


class FakeRepository:
    def __init__(self, fail_on=None):
        self.uploads = {}
        self.storage = {}
        self.raw_rows = []
        self.lines = []
        self.discovered_fields = []
        self.ratios = []
        self.fail_on = fail_on

    def create_upload(self, record):
        self._maybe_fail("create_upload")
        self.uploads[record["id"]] = {**record, "created_at": "2026-10-17T00:00:00Z"}

    def upload_original(self, storage_path, content):
        self._maybe_fail("upload_original")
        self.storage[storage_path] = content

    def update_upload(self, upload_id, user_id, changes):
        self._maybe_fail("update_upload")
        record = self.uploads[upload_id]
        if record["user_id"] == user_id:
            record.update(changes)

    def insert_raw_rows(self, rows):
        self._maybe_fail("insert_raw_rows")
        self.raw_rows.extend(rows)

    def insert_discovered_fields(self, fields):
        self._maybe_fail("insert_discovered_fields")
        self.discovered_fields.extend(fields)

    def insert_financial_lines(self, rows):
        self._maybe_fail("insert_financial_lines")
        self.lines.extend(rows)

    def insert_ratio_results(self, rows):
        self._maybe_fail("insert_ratio_results")
        self.ratios.extend(rows)

    def get_owned_upload(self, upload_id, user_id):
        record = self.uploads.get(upload_id)
        return record if record and record["user_id"] == user_id else None

    def list_owned_uploads(self, user_id, limit=50):
        return [record for record in self.uploads.values() if record["user_id"] == user_id][:limit]

    def get_owned_ratios(self, upload_id, user_id):
        return [row for row in self.ratios if row["source_upload_id"] == upload_id and row["user_id"] == user_id]

    def get_owned_discovered_fields(self, upload_id, user_id):
        return [field for field in self.discovered_fields if field["source_upload_id"] == upload_id and field["user_id"] == user_id]

    def _maybe_fail(self, name):
        if self.fail_on == name:
            raise RuntimeError("Simulated persistence error")


class FakeAuthResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        return self.payload


def make_settings():
    return Settings(
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="test-publishable-key",
        supabase_service_role_key="test-service-role-key",
        storage_bucket="financial-uploads",
        frontend_origins=("http://localhost:5173",),
        max_upload_bytes=1024 * 1024,
        max_rows=100,
        max_columns=20,
    )


def client_for(repository):
    app.dependency_overrides[get_current_user] = lambda: {"id": USER_ID, "email": "user@example.test"}
    app.dependency_overrides[get_repository] = lambda: repository
    app.dependency_overrides[get_settings] = make_settings
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_upload_persists_private_original_raw_rows_lines_and_results():
    repository = FakeRepository()
    with client_for(repository) as client:
        response = client.post(
            "/uploads",
            files={"file": ("balance.csv", b"Line Item,2023,2024\nCurrent Assets,100,120\nCurrent Liabilities,50,60\n", "text/csv")},
        )
        upload_id = response.json()["upload"]["id"]
        status_response = client.get(f"/uploads/{upload_id}")

    assert response.status_code == 201
    assert status_response.status_code == 200
    body = response.json()
    upload_id = body["upload"]["id"]
    assert status_response.json()["upload"]["id"] == upload_id
    assert status_response.json()["ratios"]
    assert status_response.json()["discovered_fields"]
    assert body["upload"]["status"] == "completed"
    assert len(repository.storage) == 1
    assert list(repository.storage.values()) == [b"Line Item,2023,2024\nCurrent Assets,100,120\nCurrent Liabilities,50,60\n"]
    assert repository.raw_rows[0]["raw_data"]["columns"] == ["Line Item", "2023", "2024"]
    assert repository.lines[0]["source_upload_id"] == upload_id
    assert any(row["ratio_identifier"] == "current_ratio" for row in repository.ratios)


def test_upload_preserves_arbitrary_source_columns_and_discovers_them_end_to_end():
    repository = FakeRepository()
    content = (
        b"Company,Period,Statement Type,Current Assets,Current Liabilities,Custom Score,Analyst Note,Approved\n"
        b"Example Co,2024,balance_sheet,120,60,7.5,stable outlook,TRUE\n"
    )
    with client_for(repository) as client:
        response = client.post("/uploads", files={"file": ("custom.csv", content, "text/csv")})
        upload_id = response.json()["upload"]["id"]
        detail = client.get(f"/uploads/{upload_id}")

    assert response.status_code == 201
    assert response.json()["upload"]["status"] == "needs_review"
    assert repository.raw_rows[0]["raw_data"] == {
        "columns": ["Company", "Period", "Statement Type", "Current Assets", "Current Liabilities", "Custom Score", "Analyst Note", "Approved"],
        "values": ["Example Co", "2024", "balance_sheet", "120", "60", "7.5", "stable outlook", "TRUE"],
    }
    catalog = {field["source_header"]: field for field in repository.discovered_fields}
    assert catalog["Custom Score"]["candidate_identifier"] == "custom_score"
    assert catalog["Custom Score"]["inferred_type"] == "numeric"
    assert catalog["Analyst Note"]["inferred_type"] == "text"
    assert catalog["Approved"]["inferred_type"] == "boolean"
    assert catalog["Period"]["field_role"] == "metadata"
    normalized = {line["field_name"]: line for line in repository.lines}
    assert normalized["current_assets"]["mapping_status"] == "mapped"
    assert normalized["custom_score"]["mapping_status"] == "unmapped"
    assert normalized["custom_score"]["raw_value"] == "7.5"
    assert normalized["analyst_note"]["raw_value"] == "stable outlook"
    assert normalized["analyst_note"]["value"] is None
    current_ratio = next(row for row in repository.ratios if row["ratio_identifier"] == "current_ratio")
    assert current_ratio["calculated_value"] == 2
    assert detail.status_code == 200
    assert {field["source_header"] for field in detail.json()["discovered_fields"]} == set(catalog)


def test_raw_rows_are_persisted_before_interpretation_errors(monkeypatch):
    repository = FakeRepository()

    def fail_interpretation(*_args, **_kwargs):
        raise RuntimeError("simulated mapping failure")

    monkeypatch.setattr(main_module, "normalize_csv_rows", fail_interpretation)
    with client_for(repository) as client:
        response = client.post(
            "/uploads",
            files={"file": ("custom.csv", b"Unregistered,Note\n0012,source text\n", "text/csv")},
        )
    assert response.status_code == 500
    assert repository.raw_rows[0]["raw_data"] == {
        "columns": ["Unregistered", "Note"],
        "values": ["0012", "source text"],
    }


def test_upload_rejects_non_csv_files_and_invalid_payloads():
    repository = FakeRepository()
    with client_for(repository) as client:
        wrong_type = client.post("/uploads", files={"file": ("statement.txt", b"not csv", "text/plain")})
        invalid_csv = client.post("/uploads", files={"file": ("bad.csv", b"Header\n", "text/csv")})

    assert wrong_type.status_code == 415
    assert invalid_csv.status_code == 422
    failed_upload = next(iter(repository.uploads.values()))
    assert failed_upload["status"] == "failed"
    assert "no data rows" in failed_upload["error_message"]


def test_persistence_failure_marks_upload_failed_and_returns_reference():
    repository = FakeRepository(fail_on="insert_ratio_results")
    with client_for(repository) as client:
        response = client.post(
            "/uploads",
            files={"file": ("balance.csv", b"Line Item,2024\nTotal Assets,100\n", "text/csv")},
        )

    assert response.status_code == 500
    assert "Reference:" in response.json()["detail"]
    failed_upload = next(iter(repository.uploads.values()))
    assert failed_upload["status"] == "failed"
    assert "configuration and migration" in failed_upload["error_message"]


def test_storage_failure_marks_upload_failed_without_exposing_provider_details():
    repository = FakeRepository(fail_on="upload_original")
    with client_for(repository) as client:
        response = client.post(
            "/uploads",
            files={"file": ("balance.csv", b"Line Item,2024\nTotal Assets,100\n", "text/csv")},
        )

    assert response.status_code == 500
    assert "Simulated persistence error" not in response.text
    failed_upload = next(iter(repository.uploads.values()))
    assert failed_upload["status"] == "failed"


def test_upload_status_is_scoped_to_the_authenticated_owner():
    repository = FakeRepository()
    other_upload_id = str(uuid4())
    repository.uploads[other_upload_id] = {
        "id": other_upload_id,
        "user_id": "8c446a5e-c194-4661-8156-12e8c6c4517b",
        "filename": "private.csv",
        "status": "completed",
        "file_size_bytes": 12,
    }
    with client_for(repository) as client:
        response = client.get(f"/uploads/{other_upload_id}")
        listing = client.get("/uploads")
    assert response.status_code == 404
    assert listing.status_code == 200
    assert all(row["id"] != other_upload_id for row in listing.json())


@pytest.mark.parametrize("method,path", [("get", "/uploads"), ("post", "/uploads")])
def test_missing_bearer_token_is_rejected(method, path):
    app.dependency_overrides[get_settings] = make_settings
    with TestClient(app) as client:
        request = getattr(client, method)
        response = request(path, files={"file": ("x.csv", b"x,y\n1,2", "text/csv")}) if method == "post" else request(path)
    assert response.status_code == 401


@pytest.mark.parametrize("method,path", [("get", "/uploads"), ("post", "/uploads")])
def test_invalid_bearer_token_is_rejected_by_upload_routes(monkeypatch, method, path):
    app.dependency_overrides[get_settings] = make_settings

    def rejected_auth_request(url, headers, timeout):
        assert url == "https://project.supabase.co/auth/v1/user"
        assert headers["Authorization"] == "Bearer invalid-access-token"
        return FakeAuthResponse(401, {"message": "invalid token"})

    monkeypatch.setattr(auth_module.httpx, "get", rejected_auth_request)
    with TestClient(app) as client:
        request = getattr(client, method)
        kwargs = {"headers": {"Authorization": "Bearer invalid-access-token"}}
        if method == "post":
            kwargs["files"] = {"file": ("x.csv", b"x,y\n1,2", "text/csv")}
        response = request(path, **kwargs)
    assert response.status_code == 401


def test_access_token_is_verified_against_supabase_user_endpoint():
    settings = make_settings()
    calls = []

    def get(url, headers, timeout):
        calls.append((url, headers, timeout))
        return FakeAuthResponse(200, {"id": USER_ID, "email": "user@example.test"})

    user = verify_access_token("user-access-token", settings, get)
    assert user["id"] == USER_ID
    assert calls[0][0] == "https://project.supabase.co/auth/v1/user"
    assert calls[0][1]["Authorization"] == "Bearer user-access-token"


def test_invalid_access_token_is_rejected():
    def get(url, headers, timeout):
        return FakeAuthResponse(401, {"message": "invalid token"})

    try:
        verify_access_token("expired-token", make_settings(), get)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("Expected an HTTP 401 for an expired token")
