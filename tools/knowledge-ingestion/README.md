# Knowledge ingestion

将 `knowledge/appliances/*.md` 稳定切分，通过本地 model-server 的
`/v1/embeddings` 生成 1024 维向量，并幂等写入当前 backend
`DATABASE_URL` 指向的 Neon。

```bash
cd tools/knowledge-ingestion
uv sync
uv run python ingest.py --dry-run
uv run python ingest.py
```

默认读取 `apps/backend/.env` 的 `DATABASE_URL` 和
`apps/model-server/.env` 的 `MODEL_SERVER_API_KEY`。正式写入前必须先运行
`cargo run --bin migrate` 创建 pgvector 表。重复执行会 UPSERT 相同
`documentId/chunkIndex`，并删除文档不再存在的旧 chunk。
