from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from threading import Lock
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from .embedding import EmbeddingEngine, OnnxEmbeddingEngine
from .engine import ChatEngine, LlamaCppEngine
from .rerank import OnnxRerankEngine, RerankEngine
from .schemas import (
    ChatCompletionRequest,
    EmbeddingData,
    EmbeddingRequest,
    EmbeddingResponse,
    EmbeddingUsage,
    RerankRequest,
    RerankResponse,
    RerankResult,
)
from .settings import Settings
from .telemetry import GpuSampler, TimedInferenceLock, parent_context, performance

ChatEngineFactory = Callable[[Settings, Lock], ChatEngine]
EmbeddingEngineFactory = Callable[[Settings, Lock], EmbeddingEngine]
RerankEngineFactory = Callable[[Settings, Lock], RerankEngine]


def create_app(
    settings: Settings | None = None,
    engine_factory: ChatEngineFactory = LlamaCppEngine,
    embedding_engine_factory: EmbeddingEngineFactory = OnnxEmbeddingEngine,
    rerank_engine_factory: RerankEngineFactory = OnnxRerankEngine,
) -> FastAPI:
    app_settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        inference_lock = TimedInferenceLock()
        gpu_sampler = GpuSampler()
        app.state.engine = await run_in_threadpool(
            engine_factory, app_settings, inference_lock
        )
        app.state.embedding_engine = await run_in_threadpool(
            embedding_engine_factory, app_settings, inference_lock
        )
        app.state.rerank_engine = await run_in_threadpool(
            rerank_engine_factory, app_settings, inference_lock
        )
        gpu_sampler.start()
        try:
            yield
        finally:
            gpu_sampler.close()
            performance.flush()

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

    def get_embedding_engine(request: Request) -> EmbeddingEngine:
        return request.app.state.embedding_engine

    def get_rerank_engine(request: Request) -> RerankEngine:
        return request.app.state.rerank_engine

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": app_settings.model_alias,
            "embeddingModel": app_settings.embedding_model_alias,
            "rerankModel": app_settings.rerank_model_alias,
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
                },
                {
                    "id": app_settings.embedding_model_alias,
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "BAAI",
                },
                {
                    "id": app_settings.rerank_model_alias,
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "BAAI",
                },
            ],
        }

    @app.post(
        "/v1/chat/completions",
        dependencies=[Depends(require_api_key)],
    )
    async def chat_completions(
        body: ChatCompletionRequest,
        request: Request,
        engine: ChatEngine = Depends(get_engine),
    ) -> Any:
        span = performance.start_span(
            "model.chat",
            parent_context(request.headers.get("traceparent")),
            attributes={"model": body.model, "endpoint": "/v1/chat/completions"},
        )
        if body.model != app_settings.model_alias:
            span.finish("error")
            raise HTTPException(status_code=404, detail="Model not found")

        if not body.stream:
            try:
                response = await run_in_threadpool(engine.complete, body)
                usage = response.get("usage", {})
                span.finish(
                    "ok",
                    {
                        "inputTokens": float(usage.get("prompt_tokens", 0)),
                        "outputTokens": float(usage.get("completion_tokens", 0)),
                    },
                )
                return response
            except Exception as error:
                span.finish("error")
                performance.capture_error("model.chat", error, span.context)
                raise

        def event_stream() -> Iterator[str]:
            started_at = time.perf_counter()
            first_token_at: float | None = None
            output_chunks = 0
            try:
                for chunk in engine.stream(body):
                    if first_token_at is None:
                        first_token_at = time.perf_counter()
                    output_chunks += 1
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                elapsed = max(time.perf_counter() - started_at, 0.000001)
                span.finish(
                    "ok",
                    {
                        "ttftMs": ((first_token_at or time.perf_counter()) - started_at) * 1000,
                        "tokensPerSecond": output_chunks / elapsed,
                    },
                )
                yield "data: [DONE]\n\n"
            except GeneratorExit:
                span.finish("cancelled")
                raise
            except Exception as error:
                span.finish("error")
                performance.capture_error("model.chat", error, span.context)
                raise

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post(
        "/v1/embeddings",
        response_model=EmbeddingResponse,
        dependencies=[Depends(require_api_key)],
    )
    async def embeddings(
        body: EmbeddingRequest,
        request: Request,
        engine: EmbeddingEngine = Depends(get_embedding_engine),
    ) -> EmbeddingResponse:
        span = performance.start_span(
            "model.embedding",
            parent_context(request.headers.get("traceparent")),
            attributes={"model": body.model, "endpoint": "/v1/embeddings"},
        )
        if body.model != app_settings.embedding_model_alias:
            span.finish("error")
            raise HTTPException(status_code=404, detail="Model not found")
        texts = [body.input] if isinstance(body.input, str) else body.input
        try:
            vectors, token_count = await run_in_threadpool(engine.embed, texts)
            span.finish(
                "ok",
                {"batchSize": float(len(texts)), "inputTokens": float(token_count)},
            )
        except Exception as error:
            span.finish("error")
            performance.capture_error("model.embedding", error, span.context)
            raise
        return EmbeddingResponse(
            data=[
                EmbeddingData(index=index, embedding=embedding)
                for index, embedding in enumerate(vectors)
            ],
            model=app_settings.embedding_model_alias,
            usage=EmbeddingUsage(
                prompt_tokens=token_count,
                total_tokens=token_count,
            ),
        )

    @app.post(
        "/v1/rerank",
        response_model=RerankResponse,
        dependencies=[Depends(require_api_key)],
    )
    async def rerank(
        body: RerankRequest,
        request: Request,
        engine: RerankEngine = Depends(get_rerank_engine),
    ) -> RerankResponse:
        span = performance.start_span(
            "model.rerank",
            parent_context(request.headers.get("traceparent")),
            attributes={"model": body.model, "endpoint": "/v1/rerank"},
        )
        if body.model != app_settings.rerank_model_alias:
            span.finish("error")
            raise HTTPException(status_code=404, detail="Model not found")
        try:
            ranked = await run_in_threadpool(engine.rerank, body.query, body.documents)
            span.finish("ok", {"batchSize": float(len(body.documents))})
        except Exception as error:
            span.finish("error")
            performance.capture_error("model.rerank", error, span.context)
            raise
        if body.top_n is not None:
            ranked = ranked[: min(body.top_n, len(ranked))]
        return RerankResponse(
            model=app_settings.rerank_model_alias,
            results=[
                RerankResult(index=index, relevance_score=score)
                for index, score in ranked
            ],
        )

    return app


app = create_app()
