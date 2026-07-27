use std::sync::Arc;

use crate::domain::knowledge::{KnowledgeChunk, KnowledgeFilter, KnowledgeRepository};

use super::error::ApplicationError;

pub struct SearchKnowledge {
    repository: Arc<dyn KnowledgeRepository>,
}

impl SearchKnowledge {
    pub fn new(repository: Arc<dyn KnowledgeRepository>) -> Self {
        Self { repository }
    }

    pub async fn execute(
        &self,
        vector: Vec<f32>,
        top_k: u64,
        filter: KnowledgeFilter,
    ) -> Result<Vec<KnowledgeChunk>, ApplicationError> {
        if vector.len() != 1024
            || vector.iter().any(|component| !component.is_finite())
            || !(1..=50).contains(&top_k)
        {
            return Err(ApplicationError::InvalidRequest);
        }
        self.repository
            .search(&vector, top_k, &filter)
            .await
            .map_err(Into::into)
    }
}
