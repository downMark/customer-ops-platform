from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import ChatCompletionRequest
from app.settings import Settings


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


def settings() -> Settings:
    return Settings(
        model_path=Path(
            "/Volumes/T7/customer-ops-model/customer-ops-q4_k_m.gguf"
        ),
        model_alias="customer-ops",
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
        verbose=False,
    )


def test_health_and_model_metadata() -> None:
    with TestClient(create_app(settings(), lambda _: FakeEngine())) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["model"] == "customer-ops"
        assert "modelPath" not in health.json()

        models = client.get(
            "/v1/models", headers={"Authorization": "Bearer test-key"}
        )
        assert models.status_code == 200
        assert models.json()["data"][0]["id"] == "customer-ops"


def test_rejects_invalid_api_key() -> None:
    with TestClient(create_app(settings(), lambda _: FakeEngine())) as client:
        response = client.get("/v1/models")
        assert response.status_code == 401


def test_streams_openai_compatible_events() -> None:
    with TestClient(create_app(settings(), lambda _: FakeEngine())) as client:
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
