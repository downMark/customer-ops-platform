use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn sql(manager: &SchemaManager<'_>, statement: &str) -> Result<(), DbErr> {
    manager
        .get_connection()
        .execute(Statement::from_string(DbBackend::Postgres, statement))
        .await?;
    Ok(())
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        sql(manager, "CREATE EXTENSION IF NOT EXISTS vector").await?;
        sql(
            manager,
            r#"CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id BIGSERIAL PRIMARY KEY,
                document_id VARCHAR(128) NOT NULL,
                chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
                content TEXT NOT NULL CHECK (length(content) > 0),
                embedding vector(1024) NOT NULL,
                source VARCHAR(512) NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                content_hash VARCHAR(64) NOT NULL,
                embedding_model VARCHAR(128) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(document_id, chunk_index)
            )"#,
        )
        .await?;
        sql(
            manager,
            r#"CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
               ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)"#,
        )
        .await?;
        sql(
            manager,
            r#"DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM products
                WHERE (product_id = 'PROD-006' AND name <> '星舟智鲜变频冰箱 520L')
                   OR (product_id = 'PROD-007' AND name <> '星舟臻彩 65 英寸 4K 智能电视')
                   OR (product_id = 'PROD-008' AND name <> '星舟创视 27 英寸 4K 显示器')
              ) THEN
                RAISE EXCEPTION 'PROD-006..008 already exist with conflicting product names';
              END IF;
            END $$"#,
        )
        .await?;
        sql(
            manager,
            r#"INSERT INTO products
                (product_id,name,price_cents,stock_quantity,is_active,created_at,updated_at)
               VALUES
                ('PROD-006','星舟智鲜变频冰箱 520L',499900,100,true,NOW(),NOW()),
                ('PROD-007','星舟臻彩 65 英寸 4K 智能电视',399900,100,true,NOW(),NOW()),
                ('PROD-008','星舟创视 27 英寸 4K 显示器',249900,100,true,NOW(),NOW())
               ON CONFLICT(product_id) DO NOTHING"#,
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        sql(manager, "DROP TABLE IF EXISTS knowledge_chunks").await?;
        sql(
            manager,
            "DELETE FROM products WHERE product_id IN ('PROD-006','PROD-007','PROD-008')",
        )
        .await
    }
}
