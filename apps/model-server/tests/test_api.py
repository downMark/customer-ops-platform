from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
import sys
from threading import Lock
import time
from typing import Any

from fastapi.testclient import TestClient

from app.engine import _format_chatml_without_thinking
from app.main import create_app
from app.schemas import ChatCompletionRequest
from app.settings import Settings
from app.telemetry import GpuSampler, TimedInferenceLock


class FakeEngine:
    def complete(self, request: ChatCompletionRequest) -> dict[str, Any]:
        return {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "已发货"},
                    "finish_reason": "stop",
                }
            ],
        }

    def stream(self, request: ChatCompletionRequest) -> Iterator[dict[str, Any]]:
        yield {
            "id": "chatcmpl-test",
            "object": "chat.completion.chunk",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": "已发货"},
                    "finish_reason": None,
                }
            ],
        }


class FakeEmbeddingEngine:
    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        return [[1.0] + [0.0] * 1023 for _ in texts], len(texts) * 3


class FakeRerankEngine:
    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        del query
        return [(index, 0.9 - index * 0.1) for index, _ in enumerate(documents)]


class FailingEngine(FakeEngine):
    def complete(self, request: ChatCompletionRequest) -> dict[str, Any]:
        raise RuntimeError("fake inference failure")


def settings() -> Settings:
    return Settings(
        model_path=Path(
            "/Volumes/T7/customer-ops-model/customer-ops-q4_k_m.gguf"
        ),
        embedding_model_path=Path(
            "/Volumes/T7/customer-ops-model/bge-m3-onnx/model.onnx"
        ),
        rerank_model_path=Path(
            "/Volumes/T7/customer-ops-model/bge-reranker-v2-m3-onnx/model.onnx"
        ),
        model_alias="customer-ops",
        embedding_model_alias="bge-m3",
        rerank_model_alias="bge-reranker-v2-m3",
        api_key="test-key",
        host="127.0.0.1",
        port=8000,
        context_size=4096,
        gpu_layers=-1,
        threads=0,
        temperature=0.2,
        top_p=0.8,
        repeat_penalty=1.1,
        max_tokens=1024,
        embedding_dim=1024,
        embedding_max_length=1024,
        rerank_max_length=1024,
        onnx_threads=1,
        disable_thinking=True,
        verbose=False,
    )


def app():
    return create_app(
        settings(),
        lambda _settings, _lock: FakeEngine(),
        lambda _settings, _lock: FakeEmbeddingEngine(),
        lambda _settings, _lock: FakeRerankEngine(),
    )


def test_health_and_model_metadata() -> None:
    with TestClient(app()) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["model"] == "customer-ops"
        assert health.json()["embeddingModel"] == "bge-m3"
        assert "modelPath" not in health.json()

        models = client.get(
            "/v1/models", headers={"Authorization": "Bearer test-key"}
        )
        assert models.status_code == 200
        assert [model["id"] for model in models.json()["data"]] == [
            "customer-ops",
            "bge-m3",
            "bge-reranker-v2-m3",
        ]


def test_rejects_invalid_api_key() -> None:
    with TestClient(app()) as client:
        response = client.get("/v1/models")
        assert response.status_code == 401


def test_streams_openai_compatible_events() -> None:
    with TestClient(app()) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={
                "model": "customer-ops",
                "stream": True,
                "messages": [{"role": "user", "content": "订单到哪里了？"}],
            },
        )
        assert response.status_code == 200
        assert '"content": "已发货"' in response.text
        assert "data: [DONE]" in response.text


def test_qwen_chat_template_starts_with_empty_thinking_block() -> None:
    formatted = _format_chatml_without_thinking(
        [
            {"role": "system", "content": "你是客服。"},
            {"role": "user", "content": "冰箱不制冷怎么办？"},
        ]
    )

    assert formatted.prompt.endswith(
        "<|im_start|>assistant\n<think>\n\n</think>\n\n"
    )
    assert "<|im_start|>user\n冰箱不制冷怎么办？<|im_end|>\n" in formatted.prompt
    assert formatted.stop == "<|im_end|>"


def test_embeddings_are_openai_compatible() -> None:
    with TestClient(app()) as client:
        response = client.post(
            "/v1/embeddings",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "bge-m3", "input": ["冰箱不制冷", "电视无画面"]},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["object"] == "list"
        assert payload["model"] == "bge-m3"
        assert len(payload["data"]) == 2
        assert len(payload["data"][0]["embedding"]) == 1024
        assert payload["usage"]["total_tokens"] == 6


def test_rerank_preserves_document_indexes() -> None:
    with TestClient(app()) as client:
        response = client.post(
            "/v1/rerank",
            headers={"Authorization": "Bearer test-key"},
            json={
                "model": "bge-reranker-v2-m3",
                "query": "冰箱不制冷",
                "documents": ["检查电源", "检查信号线", "联系售后"],
                "top_n": 2,
            },
        )
        assert response.status_code == 200
        assert response.json()["results"] == [
            {"index": 0, "relevance_score": 0.9},
            {"index": 1, "relevance_score": 0.8},
        ]


def test_retrieval_limits_are_validated() -> None:
    with TestClient(app()) as client:
        response = client.post(
            "/v1/embeddings",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "bge-m3", "input": ["x"] * 33},
        )
        assert response.status_code == 422


def test_fake_engine_failure_isolated_as_server_error() -> None:
    failing = create_app(
        settings(),
        lambda _settings, _lock: FailingEngine(),
        lambda _settings, _lock: FakeEmbeddingEngine(),
        lambda _settings, _lock: FakeRerankEngine(),
    )
    with TestClient(failing, raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={
                "Authorization": "Bearer test-key",
                "traceparent": f"00-{'a' * 32}-{'b' * 16}-01",
            },
            json={
                "model": "customer-ops",
                "stream": False,
                "messages": [{"role": "user", "content": "test"}],
            },
        )
        assert response.status_code == 500


def test_lock_and_gpu_sampler_degrade_without_gpu(monkeypatch: Any) -> None:
    lock = TimedInferenceLock()
    assert lock.acquire(blocking=False)
    assert not lock.acquire(blocking=False)
    lock.release()

    class MissingNvml:
        def nvmlInit(self) -> None:
            raise RuntimeError("no GPU")

    monkeypatch.setitem(sys.modules, "pynvml", MissingNvml())
    sampler = GpuSampler(interval_seconds=0.01)
    sampler.start()
    time.sleep(0.02)
    sampler.close()
