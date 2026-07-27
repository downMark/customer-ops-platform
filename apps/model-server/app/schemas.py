from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)
    stop: str | list[str] | None = None
    user: str | None = None
    response_format: dict[str, Any] | None = None


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str
    input: str | list[str]

    @field_validator("input")
    @classmethod
    def validate_input(cls, value: str | list[str]) -> str | list[str]:
        inputs = [value] if isinstance(value, str) else value
        if not inputs or len(inputs) > 32:
            raise ValueError("input must contain between 1 and 32 texts")
        if any(not text.strip() for text in inputs):
            raise ValueError("embedding input cannot be empty")
        return value


class EmbeddingData(BaseModel):
    object: Literal["embedding"] = "embedding"
    index: int
    embedding: list[float]


class EmbeddingUsage(BaseModel):
    prompt_tokens: int
    total_tokens: int


class EmbeddingResponse(BaseModel):
    object: Literal["list"] = "list"
    data: list[EmbeddingData]
    model: str
    usage: EmbeddingUsage


class RerankRequest(BaseModel):
    model: str
    query: str = Field(min_length=1, max_length=4_000)
    documents: list[str] = Field(min_length=1, max_length=50)
    top_n: int | None = Field(default=None, ge=1, le=50)

    @field_validator("documents")
    @classmethod
    def validate_documents(cls, value: list[str]) -> list[str]:
        if any(not document.strip() for document in value):
            raise ValueError("rerank documents cannot be empty")
        return value


class RerankResult(BaseModel):
    index: int
    relevance_score: float


class RerankResponse(BaseModel):
    model: str
    results: list[RerankResult]
