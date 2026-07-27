from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import httpx
import psycopg
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_DIR = REPO_ROOT / "knowledge" / "appliances"
DEFAULT_BACKEND_ENV = REPO_ROOT / "apps" / "backend" / ".env"
DEFAULT_MODEL_ENV = REPO_ROOT / "apps" / "model-server" / ".env"
MAX_CHARS = 1_200
OVERLAP_CHARS = 150


@dataclass(frozen=True)
class Document:
    document_id: str
    source: str
    metadata: dict[str, Any]
    body: str


@dataclass(frozen=True)
class Chunk:
    document_id: str
    index: int
    content: str
    source: str
    metadata: dict[str, Any]

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def parse_document(path: Path, source_root: Path) -> Document:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError(f"{path} must start with YAML front matter")
    front_matter = yaml.safe_load(match.group(1))
    if not isinstance(front_matter, dict):
        raise ValueError(f"{path} front matter must be an object")
    required = ("documentId", "title", "productId", "category", "version")
    missing = [key for key in required if not front_matter.get(key)]
    if missing:
        raise ValueError(f"{path} is missing front matter: {', '.join(missing)}")
    source = path.relative_to(source_root).as_posix()
    return Document(
        document_id=str(front_matter["documentId"]),
        source=f"knowledge/appliances/{source}",
        metadata={
            "title": front_matter["title"],
            "productId": front_matter["productId"],
            "category": front_matter["category"],
            "version": str(front_matter["version"]),
        },
        body=match.group(2).strip(),
    )


def chunk_document(document: Document) -> list[Chunk]:
    sections = [
        section.strip()
        for section in re.split(r"(?=^##?\s+)", document.body, flags=re.MULTILINE)
        if section.strip()
    ]
    contents: list[str] = []
    for section in sections:
        if len(section) <= MAX_CHARS:
            contents.append(section)
            continue
        start = 0
        while start < len(section):
            end = min(start + MAX_CHARS, len(section))
            contents.append(section[start:end].strip())
            if end == len(section):
                break
            start = end - OVERLAP_CHARS
    return [
        Chunk(
            document_id=document.document_id,
            index=index,
            content=content,
            source=document.source,
            metadata=document.metadata,
        )
        for index, content in enumerate(contents)
    ]


def batches(values: list[Chunk], batch_size: int) -> Iterable[list[Chunk]]:
    for start in range(0, len(values), batch_size):
        yield values[start : start + batch_size]


def embed_chunks(
    chunks: list[Chunk],
    base_url: str,
    api_key: str,
    model: str,
    batch_size: int,
) -> list[list[float]]:
    vectors: list[list[float]] = []
    with httpx.Client(timeout=120) as client:
        for batch in batches(chunks, batch_size):
            response = client.post(
                f"{base_url.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": [chunk.content for chunk in batch]},
            )
            response.raise_for_status()
            payload = response.json()
            data = sorted(payload["data"], key=lambda item: item["index"])
            batch_vectors = [item["embedding"] for item in data]
            if len(batch_vectors) != len(batch) or any(
                len(vector) != 1024 for vector in batch_vectors
            ):
                raise RuntimeError("model-server returned invalid embeddings")
            vectors.extend(batch_vectors)
    return vectors


def upsert_documents(
    database_url: str,
    chunks: list[Chunk],
    vectors: list[list[float]],
    embedding_model: str,
) -> None:
    if len(chunks) != len(vectors):
        raise ValueError("chunk/vector counts do not match")
    grouped_counts: dict[str, int] = {}
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for chunk, vector in zip(chunks, vectors, strict=True):
                grouped_counts[chunk.document_id] = grouped_counts.get(
                    chunk.document_id, 0
                ) + 1
                vector_text = "[" + ",".join(str(value) for value in vector) + "]"
                cursor.execute(
                    """
                    INSERT INTO knowledge_chunks
                      (document_id,chunk_index,content,embedding,source,metadata,
                       content_hash,embedding_model,created_at,updated_at)
                    VALUES (%s,%s,%s,%s::vector,%s,%s::jsonb,%s,%s,NOW(),NOW())
                    ON CONFLICT(document_id,chunk_index) DO UPDATE SET
                      content=EXCLUDED.content,
                      embedding=EXCLUDED.embedding,
                      source=EXCLUDED.source,
                      metadata=EXCLUDED.metadata,
                      content_hash=EXCLUDED.content_hash,
                      embedding_model=EXCLUDED.embedding_model,
                      updated_at=CASE
                        WHEN knowledge_chunks.content_hash <> EXCLUDED.content_hash
                          OR knowledge_chunks.embedding_model <> EXCLUDED.embedding_model
                        THEN NOW() ELSE knowledge_chunks.updated_at END
                    """,
                    (
                        chunk.document_id,
                        chunk.index,
                        chunk.content,
                        vector_text,
                        chunk.source,
                        json.dumps(chunk.metadata, ensure_ascii=False),
                        chunk.content_hash,
                        embedding_model,
                    ),
                )
            for document_id, count in grouped_counts.items():
                cursor.execute(
                    "DELETE FROM knowledge_chunks "
                    "WHERE document_id=%s AND chunk_index >= %s",
                    (document_id, count),
                )
        connection.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest customer support Markdown")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--database-url")
    parser.add_argument(
        "--model-server-base-url",
        default=os.getenv("MODEL_SERVER_BASE_URL", "http://127.0.0.1:8000/v1"),
    )
    parser.add_argument("--api-key")
    parser.add_argument("--embedding-model", default="bge-m3")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    backend_env = read_env(DEFAULT_BACKEND_ENV)
    model_env = read_env(DEFAULT_MODEL_ENV)
    database_url = (
        args.database_url
        or os.getenv("DATABASE_URL")
        or backend_env.get("DATABASE_URL")
    )
    api_key = (
        args.api_key
        or os.getenv("MODEL_SERVER_API_KEY")
        or model_env.get("MODEL_SERVER_API_KEY")
        or "local-model-server"
    )
    documents = [
        parse_document(path, args.source_dir)
        for path in sorted(args.source_dir.glob("*.md"))
        if not path.name.startswith("._")
    ]
    chunks = [chunk for document in documents for chunk in chunk_document(document)]
    summary = {
        "documents": len(documents),
        "chunks": len(chunks),
        "byDocument": {
            document.document_id: sum(
                chunk.document_id == document.document_id for chunk in chunks
            )
            for document in documents
        },
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    if not (1 <= args.batch_size <= 32):
        raise SystemExit("--batch-size must be between 1 and 32")
    vectors = embed_chunks(
        chunks,
        args.model_server_base_url,
        api_key,
        args.embedding_model,
        args.batch_size,
    )
    upsert_documents(database_url, chunks, vectors, args.embedding_model)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
