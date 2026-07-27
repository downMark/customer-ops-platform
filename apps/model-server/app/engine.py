from __future__ import annotations

from collections.abc import Iterator
from threading import Lock
from typing import Any, Protocol, cast

from llama_cpp import Llama

from .schemas import ChatCompletionRequest
from .settings import Settings


class ChatEngine(Protocol):
    def complete(self, request: ChatCompletionRequest) -> dict[str, Any]: ...

    def stream(self, request: ChatCompletionRequest) -> Iterator[dict[str, Any]]: ...


class LlamaCppEngine:
    def __init__(self, settings: Settings, inference_lock: Lock | None = None) -> None:
        settings.validate_chat()
        kwargs: dict[str, Any] = {
            "model_path": str(settings.model_path),
            "n_ctx": settings.context_size,
            "n_gpu_layers": settings.gpu_layers,
            "verbose": settings.verbose,
        }
        if settings.threads > 0:
            kwargs["n_threads"] = settings.threads

        self._llm = Llama(**kwargs)
        self._settings = settings
        self._lock = inference_lock or Lock()

    def _arguments(self, request: ChatCompletionRequest) -> dict[str, Any]:
        arguments: dict[str, Any] = {
            "messages": [message.model_dump() for message in request.messages],
            "temperature": request.temperature
            if request.temperature is not None
            else self._settings.temperature,
            "top_p": request.top_p
            if request.top_p is not None
            else self._settings.top_p,
            "repeat_penalty": self._settings.repeat_penalty,
            "max_tokens": min(
                request.max_tokens or self._settings.max_tokens,
                self._settings.max_tokens,
            ),
            "stop": request.stop,
        }
        if request.response_format is not None:
            arguments["response_format"] = request.response_format
        return arguments

    def complete(self, request: ChatCompletionRequest) -> dict[str, Any]:
        with self._lock:
            result = self._llm.create_chat_completion(
                **self._arguments(request),
                stream=False,
            )
            return cast(dict[str, Any], result)

    def stream(self, request: ChatCompletionRequest) -> Iterator[dict[str, Any]]:
        def generate() -> Iterator[dict[str, Any]]:
            with self._lock:
                result = self._llm.create_chat_completion(
                    **self._arguments(request),
                    stream=True,
                )
                yield from cast(Iterator[dict[str, Any]], result)

        return generate()
