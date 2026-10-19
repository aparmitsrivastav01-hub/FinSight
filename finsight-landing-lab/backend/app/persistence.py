from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from .config import Settings


class SupabaseRepository:
    def __init__(self, settings: Settings, client: Client | None = None):
        settings.require_admin_configuration()
        self.settings = settings
        self.client = client or create_client(settings.supabase_url, settings.supabase_service_role_key)

    def create_upload(self, record: dict[str, Any]) -> None:
        self.client.table("financial_uploads").insert(record).execute()

    def upload_original(self, storage_path: str, content: bytes) -> None:
        self.client.storage.from_(self.settings.storage_bucket).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": "text/csv", "upsert": "false"},
        )

    def update_upload(self, upload_id: str, user_id: str, changes: dict[str, Any]) -> None:
        self.client.table("financial_uploads").update(changes).eq("id", upload_id).eq("user_id", user_id).execute()

    def insert_raw_rows(self, rows: list[dict[str, Any]]) -> None:
        self._insert_in_batches("raw_financial_rows", rows)

    def insert_discovered_fields(self, fields: list[dict[str, Any]]) -> None:
        if fields:
            self._insert_in_batches("financial_upload_fields", fields)

    def insert_financial_lines(self, rows: list[dict[str, Any]]) -> None:
        self._insert_in_batches("financial_statements", rows)

    def insert_ratio_results(self, rows: list[dict[str, Any]]) -> None:
        self._insert_in_batches("ratio_results", rows)

    def get_owned_upload(self, upload_id: str, user_id: str) -> dict[str, Any] | None:
        response = (
            self.client.table("financial_uploads")
            .select("id,user_id,filename,status,error_message,row_count,column_count,file_size_bytes,created_at,completed_at,mapping_review_count,company_name")
            .eq("id", upload_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_owned_uploads(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        response = (
            self.client.table("financial_uploads")
            .select("id,filename,status,error_message,row_count,column_count,file_size_bytes,created_at,completed_at,mapping_review_count,company_name")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []

    def get_owned_ratios(self, upload_id: str, user_id: str) -> list[dict[str, Any]]:
        response = (
            self.client.table("ratio_results")
            .select("id,period,company_name,ratio_identifier,calculated_value,unit,calculation_status,formula_version,calculated_at,input_values,reason")
            .eq("source_upload_id", upload_id)
            .eq("user_id", user_id)
            .order("period")
            .order("ratio_identifier")
            .execute()
        )
        return response.data or []

    def get_owned_discovered_fields(self, upload_id: str, user_id: str) -> list[dict[str, Any]]:
        response = (
            self.client.table("financial_upload_fields")
            .select("ordinal,source_header,candidate_identifier,canonical_identifier,statement_type,field_role,inferred_type,value_count,mapping_status")
            .eq("source_upload_id", upload_id)
            .eq("user_id", user_id)
            .order("ordinal")
            .execute()
        )
        return response.data or []

    def _insert_in_batches(self, table: str, rows: list[dict[str, Any]], batch_size: int = 500) -> None:
        # Bound each REST request so large but valid CSV files remain processable.
        for start in range(0, len(rows), batch_size):
            self.client.table(table).insert(rows[start : start + batch_size]).execute()
