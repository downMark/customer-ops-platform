use async_trait::async_trait;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement, Value};

use crate::domain::knowledge::{KnowledgeChunk, KnowledgeFilter, KnowledgeRepository};
use crate::domain::repository::RepoError;
use crate::infra::error::map_db_err;
use crate::performance;

pub struct SeaOrmKnowledgeRepository {
    db: DatabaseConnection,
}

impl SeaOrmKnowledgeRepository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }
}

#[async_trait]
impl KnowledgeRepository for SeaOrmKnowledgeRepository {
    async fn search(
        &self,
        vector: &[f32],
        top_k: u64,
        filter: &KnowledgeFilter,
    ) -> Result<Vec<KnowledgeChunk>, RepoError> {
        let span = performance::client().start_span("db.knowledge.search", None);
        let vector_text = format!(
            "[{}]",
            vector
                .iter()
                .map(|component| component.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut sql = String::from(
            r#"SELECT id, document_id, chunk_index, content, source,
                      metadata::text AS metadata_text,
                      1 - (embedding <=> $1::vector) AS score
               FROM knowledge_chunks
               WHERE TRUE"#,
        );
        let mut values: Vec<Value> = vec![vector_text.into()];
        if let Some(product_id) = filter.product_id.as_ref() {
            values.push(product_id.clone().into());
            sql.push_str(&format!(" AND metadata->>'productId' = ${}", values.len()));
        }
        if let Some(category) = filter.category.as_ref() {
            values.push(category.clone().into());
            sql.push_str(&format!(" AND metadata->>'category' = ${}", values.len()));
        }
        if let Some(source) = filter.source.as_ref() {
            values.push(source.clone().into());
            sql.push_str(&format!(" AND source = ${}", values.len()));
        }
        values.push((top_k as i64).into());
        let limit_parameter = values.len();
        sql.push_str(&format!(
            " ORDER BY embedding <=> $1::vector LIMIT ${limit_parameter}"
        ));

        let rows = self
            .db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                values,
            ))
            .await
            .map_err(map_db_err)?;

        let result = rows
            .into_iter()
            .map(|row| {
                let metadata_text: String = row.try_get("", "metadata_text").map_err(map_db_err)?;
                let metadata = serde_json::from_str(&metadata_text)
                    .map_err(|error| RepoError::Other(error.to_string()))?;
                Ok(KnowledgeChunk {
                    id: row.try_get("", "id").map_err(map_db_err)?,
                    document_id: row.try_get("", "document_id").map_err(map_db_err)?,
                    chunk_index: row.try_get("", "chunk_index").map_err(map_db_err)?,
                    content: row.try_get("", "content").map_err(map_db_err)?,
                    source: row.try_get("", "source").map_err(map_db_err)?,
                    metadata,
                    score: row.try_get("", "score").map_err(map_db_err)?,
                })
            })
            .collect();
        span.finish("ok");
        result
    }
}
