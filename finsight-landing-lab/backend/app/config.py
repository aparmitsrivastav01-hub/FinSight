from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_publishable_key: str
    supabase_service_role_key: str
    storage_bucket: str
    frontend_origins: tuple[str, ...]
    max_upload_bytes: int
    max_rows: int
    max_columns: int

    @classmethod
    def from_environment(cls) -> "Settings":
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv(
                "FRONTEND_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        )
        if "*" in origins:
            raise ValueError("FRONTEND_ORIGINS must not contain '*'.")
        return cls(
            supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
            supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY", ""),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "financial-uploads"),
            frontend_origins=origins,
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
            max_rows=int(os.getenv("MAX_CSV_ROWS", "20000")),
            max_columns=int(os.getenv("MAX_CSV_COLUMNS", "150")),
        )

    def require_auth_configuration(self) -> None:
        if not self.supabase_url or not self.supabase_publishable_key:
            raise RuntimeError("Backend Supabase URL and publishable key are not configured.")

    def require_admin_configuration(self) -> None:
        if not self.supabase_url or not self.supabase_service_role_key:
            raise RuntimeError("Backend Supabase URL and service role key are not configured.")


@lru_cache
def get_settings() -> Settings:
    return Settings.from_environment()
