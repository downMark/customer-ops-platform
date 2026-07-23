from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _integer(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error


def _floating(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error


def _boolean(name: str, default: bool) -> bool:
    raw = os.getenv(name, str(default)).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


@dataclass(frozen=True)
class Settings:
    model_path: Path
    model_alias: str
    api_key: str
    host: str
    port: int
    context_size: int
    gpu_layers: int
    threads: int
    temperature: float
    top_p: float
    repeat_penalty: float
    max_tokens: int
    verbose: bool

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model_path=Path(
                os.getenv(
                    "MODEL_PATH",
                    "/Volumes/T7/customer-ops-model/customer-ops-q4_k_m.gguf",
                )
            ),
            model_alias=os.getenv("MODEL_ALIAS", "customer-ops"),
            api_key=os.getenv("MODEL_SERVER_API_KEY", "local-model-server"),
            host=os.getenv("MODEL_HOST", "127.0.0.1"),
            port=_integer("MODEL_PORT", 8000),
            context_size=_integer("MODEL_CONTEXT_SIZE", 4096),
            gpu_layers=_integer("MODEL_GPU_LAYERS", -1),
            threads=_integer("MODEL_THREADS", 0),
            temperature=_floating("MODEL_TEMPERATURE", 0.2),
            top_p=_floating("MODEL_TOP_P", 0.8),
            repeat_penalty=_floating("MODEL_REPEAT_PENALTY", 1.1),
            max_tokens=_integer("MODEL_MAX_TOKENS", 1024),
            verbose=_boolean("MODEL_VERBOSE", False),
        )

    def validate(self) -> None:
        if not self.model_path.is_file():
            raise FileNotFoundError(f"GGUF model not found: {self.model_path}")
        if not self.model_alias.strip():
            raise ValueError("MODEL_ALIAS cannot be empty")
        if not self.api_key:
            raise ValueError("MODEL_SERVER_API_KEY cannot be empty")
        if self.port <= 0 or self.port > 65535:
            raise ValueError("MODEL_PORT must be between 1 and 65535")
        if self.context_size <= 0 or self.max_tokens <= 0:
            raise ValueError("context size and max tokens must be positive")
