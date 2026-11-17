"""Environment-based configuration. No secrets are hardcoded."""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"), extra="ignore")

    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'campaign_pulse.db'}"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    email_provider: str = "simulation"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_import_rows: int = 20000
    # Optional shared secret. When set, every mutating request must send X-API-Key.
    api_key: str = ""
    unsubscribe_base_url: str = "https://example.com/unsubscribe"

    @field_validator("database_url")
    @classmethod
    def _resolve_sqlite_path(cls, v: str) -> str:
        """Relative SQLite paths are resolved against backend/ so they work from any working directory."""
        prefix = "sqlite:///"
        if v.startswith(prefix) and not v.startswith("sqlite:////") and ":memory:" not in v:
            return f"{prefix}{(BACKEND_DIR / v[len(prefix):]).resolve()}"
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
