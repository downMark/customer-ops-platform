//! `GET /api/health` — 健康检查，返回统一响应封装，不暴露任何敏感信息。

use axum::Json;
use serde::Serialize;

use crate::response::ApiResponse;

#[derive(Debug, Serialize)]
pub struct HealthView {
    pub status: &'static str,
}

pub async fn health() -> Json<ApiResponse<HealthView>> {
    Json(ApiResponse::ok(HealthView { status: "ok" }))
}
