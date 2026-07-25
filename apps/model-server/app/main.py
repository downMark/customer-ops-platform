from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from .engine import ChatEngine, LlamaCppEngine
from .schemas import ChatCompletionRequest
from .settings import Settings

EngineFactory = Callable[[Settings], ChatEngine]


def create_app(
    settings: Settings | None = None,
    engine_factory: EngineFactory = LlamaCppEngine,
) -> FastAPI:
    app_settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = await run_in_threadpool(engine_factory, app_settings)
        yield

    app = FastAPI(
        title="Customer Ops Model Server",
        version="0.1.0",
        lifespan=lifespan,
    )

    def require_api_key(authorization: str | None = Header(default=None)) -> None:
        if authorization != f"Bearer {app_settings.api_key}":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid model server API key",
            )

    def get_engine(request: Request) -> ChatEngine:
        return request.app.state.engine

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": app_settings.model_alias,
        }

    @app.get("/v1/models", dependencies=[Depends(require_api_key)])
    async def models() -> dict[str, Any]:
        return {
            "object": "list",
            "data": [
                {
                    "id": app_settings.model_alias,
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "customer-ops",
                }
            ],
        }

    @app.post(
        "/v1/chat/completions",
        dependencies=[Depends(require_api_key)],
    )
    async def chat_completions(
        body: ChatCompletionRequest,
        engine: ChatEngine = Depends(get_engine),
    ) -> Any:
        if body.model != app_settings.model_alias:
            raise HTTPException(status_code=404, detail="Model not found")

        if not body.stream:
            return await run_in_threadpool(engine.complete, body)

        def event_stream() -> Iterator[str]:
            for chunk in engine.stream(body):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    return app


app = create_app()
