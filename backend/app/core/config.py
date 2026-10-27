from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    gemini_api_key: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14

    intervention_poll_interval_seconds: int = 60
    intervention_worker_enabled: bool = True
    intervention_approaching_hours: int = 24

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

settings = Settings()