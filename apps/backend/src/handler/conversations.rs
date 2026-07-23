//! `POST /api/conversations/{conversationId}/complete` — 记录完成并发布事件。
//! 契约未在 docs 定义，暂定于此（见 specs/LESSONS.md），待与 model-api 对齐。

use axum::extract::{Path, State};
use axum::{Extension, Json};
use serde::Deserialize;

use crate::application::complete_conversation::{CompleteCommand, CompletionView};
use crate::domain::auth::AuthUser;
use crate::handler::middleware::TraceId;
use crate::response::{ApiResponse, AppError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub order_id: String,
}

pub async fn complete_conversation(
    State(state): State<AppState>,
    _auth: AuthUser,
    Extension(trace): Extension<TraceId>,
    Path(conversation_id): Path<String>,
    Json(body): Json<CompleteRequest>,
) -> Result<Json<ApiResponse<CompletionView>>, AppError> {
    let cmd = CompleteCommand {
        conversation_id,
        order_id: body.order_id,
        trace_id: trace.0,
    };
    let view = state.complete_conversation.execute(cmd).await?;
    Ok(Json(ApiResponse::ok(view)))
}
