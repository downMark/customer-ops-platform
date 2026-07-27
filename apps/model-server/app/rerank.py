from __future__ import annotations

from threading import Lock
from typing import Protocol

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from .embedding import _session_options
from .settings import Settings


class RerankEngine(Protocol):
    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]: ...


class OnnxRerankEngine:
    def __init__(self, settings: Settings, inference_lock: Lock | None = None) -> None:
        settings.validate_retrieval()
        self._lock = inference_lock or Lock()
        self._tokenizer = Tokenizer.from_file(
            str(settings.rerank_model_path.with_name("tokenizer.json"))
        )
        self._tokenizer.enable_truncation(max_length=settings.rerank_max_length)
        pad_id = self._tokenizer.token_to_id("<pad>")
        self._tokenizer.enable_padding(
            pad_id=pad_id if pad_id is not None else 1,
            pad_token="<pad>",
        )
        self._session = ort.InferenceSession(
            str(settings.rerank_model_path),
            sess_options=_session_options(settings.onnx_threads),
            providers=["CPUExecutionProvider"],
        )

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        encodings = self._tokenizer.encode_batch(
            [(query, document) for document in documents],
            add_special_tokens=True,
        )
        input_ids = np.asarray([encoding.ids for encoding in encodings], dtype=np.int64)
        attention_mask = np.asarray(
            [encoding.attention_mask for encoding in encodings], dtype=np.int64
        )
        with self._lock:
            logits = self._session.run(
                ["logits"],
                {"input_ids": input_ids, "attention_mask": attention_mask},
            )[0]
        logits = np.asarray(logits, dtype=np.float32).reshape(-1)
        scores = np.empty_like(logits)
        positive = logits >= 0
        scores[positive] = 1.0 / (1.0 + np.exp(-logits[positive]))
        exp_values = np.exp(logits[~positive])
        scores[~positive] = exp_values / (1.0 + exp_values)
        return sorted(
            enumerate(float(score) for score in scores),
            key=lambda item: (-item[1], item[0]),
        )
