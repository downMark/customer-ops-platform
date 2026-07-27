from __future__ import annotations

from threading import Lock
from typing import Protocol

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from .settings import Settings


class EmbeddingEngine(Protocol):
    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]: ...


class OnnxEmbeddingEngine:
    def __init__(self, settings: Settings, inference_lock: Lock | None = None) -> None:
        settings.validate_retrieval()
        self._settings = settings
        self._lock = inference_lock or Lock()
        self._tokenizer = Tokenizer.from_file(
            str(settings.embedding_model_path.with_name("tokenizer.json"))
        )
        self._tokenizer.enable_truncation(max_length=settings.embedding_max_length)
        pad_id = self._tokenizer.token_to_id("<pad>")
        self._tokenizer.enable_padding(
            pad_id=pad_id if pad_id is not None else 1,
            pad_token="<pad>",
        )
        self._session = ort.InferenceSession(
            str(settings.embedding_model_path),
            sess_options=_session_options(settings.onnx_threads),
            providers=["CPUExecutionProvider"],
        )

    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        encodings = self._tokenizer.encode_batch(texts, add_special_tokens=True)
        input_ids = np.asarray([encoding.ids for encoding in encodings], dtype=np.int64)
        attention_mask = np.asarray(
            [encoding.attention_mask for encoding in encodings], dtype=np.int64
        )
        with self._lock:
            vectors = self._session.run(
                ["sentence_embedding"],
                {"input_ids": input_ids, "attention_mask": attention_mask},
            )[0]
        vectors = np.asarray(vectors, dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[1] != self._settings.embedding_dim:
            raise RuntimeError(
                f"unexpected embedding shape {vectors.shape}; "
                f"expected (*, {self._settings.embedding_dim})"
            )
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise RuntimeError("embedding model returned a zero vector")
        normalized = vectors / norms
        token_count = sum(sum(encoding.attention_mask) for encoding in encodings)
        return normalized.tolist(), token_count


def _session_options(threads: int) -> ort.SessionOptions:
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return options
