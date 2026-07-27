use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::domain::auth::AuthUser;
use crate::domain::knowledge::{KnowledgeChunk, KnowledgeFilter};
use crate::response::{ApiResponse, AppError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchRequest {
    pub vector: Vec<f32>,
    pub top_k: Option<u64>,
    pub filters: Option<KnowledgeSearchFilters>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchFilters {
    pub product_id: Option<String>,
    pub category: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct KnowledgeSearchResponse {
    pub items: Vec<KnowledgeChunk>,
}

pub async fn search(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<KnowledgeSearchRequest>,
) -> Result<Json<ApiResponse<KnowledgeSearchResponse>>, AppError> {
    let filters = body.filters.unwrap_or(KnowledgeSearchFilters {
        product_id: None,
        category: None,
        source: None,
    });
    let items = state
        .search_knowledge
        .execute(
            body.vector,
            body.top_k.unwrap_or(20),
            KnowledgeFilter {
                product_id: filters.product_id,
                category: filters.category,
                source: filters.source,
            },
        )
        .await?;
    Ok(Json(ApiResponse::ok(KnowledgeSearchResponse { items })))
}
