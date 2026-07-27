use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

use super::repository::RepoError;

#[derive(Debug, Clone, Default)]
pub struct KnowledgeFilter {
    pub product_id: Option<String>,
    pub category: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunk {
    pub id: i64,
    pub document_id: String,
    pub chunk_index: i32,
    pub content: String,
    pub source: String,
    pub metadata: Value,
    pub score: f64,
}

#[async_trait]
pub trait KnowledgeRepository: Send + Sync {
    async fn search(
        &self,
        vector: &[f32],
        top_k: u64,
        filter: &KnowledgeFilter,
    ) -> Result<Vec<KnowledgeChunk>, RepoError>;
}
