use crate::{
    domain::{
        auth::AuthUser,
        product::{ProductPageView, ProductView},
    },
    response::{ApiResponse, AppError},
    state::AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    keyword: Option<String>,
    active: Option<bool>,
}
pub async fn list(
    State(s): State<AppState>,
    _auth: AuthUser,
    Query(q): Query<ProductQuery>,
) -> Result<Json<ApiResponse<ProductPageView>>, AppError> {
    Ok(Json(ApiResponse::ok(
        s.products
            .list(
                q.page.unwrap_or(1),
                q.page_size.unwrap_or(20),
                q.keyword,
                q.active,
            )
            .await?,
    )))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProduct {
    product_id: String,
    name: String,
    price_cents: i64,
    stock_quantity: i32,
}
pub async fn create(
    State(s): State<AppState>,
    auth: AuthUser,
    Json(b): Json<CreateProduct>,
) -> Result<Json<ApiResponse<ProductView>>, AppError> {
    Ok(Json(ApiResponse::ok(
        s.products
            .create(&auth, b.product_id, b.name, b.price_cents, b.stock_quantity)
            .await?,
    )))
}
