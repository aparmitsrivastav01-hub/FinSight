# FinSight financial ingestion API

Phase 1 provides a separate FastAPI service for authenticated CSV ingestion, private original-file storage, raw-row preservation, flexible normalized line items, and deterministic financial ratios.

## Windows setup

From PowerShell, in the project root:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `backend/.env` and set the Supabase project URL, publishable key, and **service role key**. Keep the service role key only in this backend file or a backend secret manager. Never place it in a `VITE_` variable or commit `.env`.

Run the migration described below, then start the API:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The health check is `http://127.0.0.1:8000/health`. OpenAPI docs are at `http://127.0.0.1:8000/docs` during development.

## Supabase setup

1. In the Supabase Dashboard, open **SQL Editor**, inspect and run migrations in order: `backend/migrations/001_financial_ingestion.sql`, then `backend/migrations/002_dynamic_field_discovery.sql`. Both are additive and safe to rerun. They create the financial tables, a generic per-upload discovered-field catalog, owner-scoped read policies, indexes, and a private `financial-uploads` bucket. They do not delete records. The bucket conflict clause explicitly keeps this bucket private.
2. Confirm **Storage → financial-uploads** is private and its size limit is at least the API's `MAX_UPLOAD_BYTES` (10 MiB by default). The API stores files as `<verified-user-id>/<upload-id>/original.csv`; it does not create public URLs.
3. Put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. The API verifies each incoming bearer token against Supabase Auth's `/auth/v1/user` endpoint. It derives the owner ID from that verified response, never from request form data.
4. Set `FRONTEND_ORIGINS` to the exact Vite origin(s) used in development and deployment. Wildcard origins are rejected.

Supabase persistence requires the migrations and backend environment configuration above. Existing installations that already ran migration 001 should run migration 002 once to add the discovered-field catalog. The migration preserves existing uploads and raw rows but does not backfill discovered-field catalogs for old uploads; re-upload an older source only if you need it reprocessed into the new field catalog and normalized model.

## Run the frontend

From the repository root in a second PowerShell window:

```powershell
npm run dev
```

The upload client uses `VITE_FINANCIAL_API_URL` when set, otherwise `http://localhost:8000`. The API accepts a Supabase access token in the `Authorization: Bearer ...` header. CSV selection in the existing upload dialog starts the upload and shows transfer/processing status, validation errors, and mapping-review counts.

## API

- `GET /health` — service liveness.
- `POST /uploads` — authenticated multipart field `file`; validates and stores the original file, raw rows, normalized line items, and ratio results. Response status is `completed` or `needs_review`.
- `GET /uploads` — authenticated list of the caller's most recent 50 uploads, suitable for a future Analytics view.
- `GET /uploads/{upload_id}` — authenticated processing status and stored ratios. Only the verified owner can retrieve it; other users receive the same 404 as an unknown ID.

Upload and status responses include the discovered source-field catalog, including original headers, candidate identifiers, inferred types, metadata roles, canonical matches, and mapping status.

The current API processes CSVs synchronously within the upload request. Limits default to 10 MiB, 20,000 data rows, and 150 columns. Configure them with the environment variables in `.env.example`.

## Financial mapping and calculations

Every accepted source row is first stored in `raw_financial_rows.raw_data` as original `columns` and `values` arrays, preserving duplicate headers and unknown/custom columns. Field discovery then records original headers, stable candidate identifiers, inferred types, metadata roles, canonical matches, and review states in `financial_upload_fields`. Per-row field/value records use the generic `financial_statements` table; new CSV headers do not require additional SQL columns. Discovery and canonical interpretation run after raw-row persistence, so a mapping failure does not discard source rows.

`app/normalization.py` supports wide period columns, long rows with explicit period/value columns, header-based metrics, explicit statement types, and filename/line-item defaults. It recognizes balance sheet, income statement, cash flow, changes in equity, notes, and other schedules. Unknown fields are retained as custom/unmapped values and are never guessed into formulas.

Line-item aliases and calculation formulas are versioned. `app/calculations.py` records source rows and original headers for every input. Recognized numeric aliases with mixed, invalid, missing, or ambiguous values cannot feed calculations. The calculator never substitutes total liabilities for total debt, and average-balance ratios require a consecutive prior period. Currency and unit mismatches make calculations unavailable with explicit reasons. No LLM or Altman Z-Score is used.

The Analytics page reads stored ratios and discovered fields from the authenticated upload endpoints. Custom fields are shown as stored/unmapped until an explicit canonical mapping is available.

## Tests

From `backend/` with its virtual environment activated:

```powershell
python -m pytest -q
```

The tests cover arbitrary headers and types, raw-row preservation through the upload path, metadata extraction, aliases, period handling, formulas, missing/invalid/ambiguous/mixed values, zero denominators, token verification, owner isolation, and storage/database failure handling with a fake repository. They do not contact a Supabase project; run an integration test after configuring a non-production Supabase project to verify actual Storage, migrations, and database persistence.
