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
    embedding_model_path: Path
    rerank_model_path: Path
    model_alias: str
    embedding_model_alias: str
    rerank_model_alias: str
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
    embedding_dim: int
    embedding_max_length: int
    rerank_max_length: int
    onnx_threads: int
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
            embedding_model_path=Path(
                os.getenv(
                    "EMBEDDING_MODEL_PATH",
                    "/Volumes/T7/customer-ops-model/bge-m3-onnx/model.onnx",
                )
            ),
            rerank_model_path=Path(
                os.getenv(
                    "RERANK_MODEL_PATH",
                    "/Volumes/T7/customer-ops-model/bge-reranker-v2-m3-onnx/model.onnx",
                )
            ),
            model_alias=os.getenv("MODEL_ALIAS", "customer-ops"),
            embedding_model_alias=os.getenv("EMBEDDING_MODEL_ALIAS", "bge-m3"),
            rerank_model_alias=os.getenv(
                "RERANK_MODEL_ALIAS", "bge-reranker-v2-m3"
            ),
            api_key=os.getenv("MODEL_SERVER_API_KEY", "local-model-server"),
            host=os.getenv("MODEL_HOST", "127.0.0.1"),
            port=_integer("MODEL_PORT", 8000),
            context_size=_integer("MODEL_CONTEXT_SIZE", 4096),
            gpu_layers=_integer("MODEL_GPU_LAYERS", 0),
            threads=_integer("MODEL_THREADS", 0),
            temperature=_floating("MODEL_TEMPERATURE", 0.2),
            top_p=_floating("MODEL_TOP_P", 0.8),
            repeat_penalty=_floating("MODEL_REPEAT_PENALTY", 1.1),
            max_tokens=_integer("MODEL_MAX_TOKENS", 1024),
            embedding_dim=_integer("EMBEDDING_DIM", 1024),
            embedding_max_length=_integer("EMBEDDING_MAX_LENGTH", 1024),
            rerank_max_length=_integer("RERANK_MAX_LENGTH", 1024),
            onnx_threads=_integer("ONNX_THREADS", 1),
            verbose=_boolean("MODEL_VERBOSE", False),
        )

    def validate_chat(self) -> None:
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

    def validate_retrieval(self) -> None:
        for label, path in (
            ("embedding", self.embedding_model_path),
            ("rerank", self.rerank_model_path),
        ):
            if not path.is_file():
                raise FileNotFoundError(f"{label} ONNX model not found: {path}")
            if not path.with_name("model.onnx_data").is_file():
                raise FileNotFoundError(
                    f"{label} ONNX external data not found: "
                    f"{path.with_name('model.onnx_data')}"
                )
            if not path.with_name("tokenizer.json").is_file():
                raise FileNotFoundError(
                    f"{label} tokenizer not found: "
                    f"{path.with_name('tokenizer.json')}"
                )
        if self.embedding_dim <= 0:
            raise ValueError("EMBEDDING_DIM must be positive")
        if self.embedding_max_length <= 0 or self.rerank_max_length <= 0:
            raise ValueError("ONNX max lengths must be positive")
        if self.onnx_threads <= 0:
            raise ValueError("ONNX_THREADS must be positive")

    def validate(self) -> None:
        self.validate_chat()
        self.validate_retrieval()
