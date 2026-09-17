"""Bot configuration from environment / .env.

Required at startup: TELEGRAM_BOT_TOKEN, INTERNAL_API_SECRET. A missing value
fails loudly before the bot ever connects to Telegram.
"""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    telegram_bot_token: str = Field(..., alias="TELEGRAM_BOT_TOKEN", min_length=1)
    api_base_url: str = Field("http://localhost:3001", alias="API_BASE_URL")
    internal_api_secret: str = Field(..., alias="INTERNAL_API_SECRET", min_length=8)
    redis_url: str = Field("redis://localhost:6380", alias="REDIS_URL")
    console_url: str = Field("http://localhost:3000", alias="CONSOLE_URL")
    log_level: str = Field("INFO", alias="LOG_LEVEL")


def load() -> Settings:
    return Settings()  # type: ignore[call-arg]
