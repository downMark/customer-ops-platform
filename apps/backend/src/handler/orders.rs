//! `GET /api/orders/{orderId}` — 鉴权 + 归属校验 + 查询，返回统一响应封装。

use axum::extract::{Path, State};
use axum::Json;

use crate::domain::auth::AuthUser;
use crate::domain::order::OrderView;
use crate::response::{ApiResponse, AppError};
use crate::state::AppState;

pub async fn get_order(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(order_id): Path<String>,
) -> Result<Json<ApiResponse<OrderView>>, AppError> {
    let view = state.get_order.execute(&auth, &order_id).await?;
    Ok(Json(ApiResponse::ok(view)))
}
