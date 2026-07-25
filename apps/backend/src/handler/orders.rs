//! 订单 HTTP 接口：分页查询、新增、按订单号查询。

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::application::create_order::CreateOrderCommand;
use crate::domain::auth::AuthUser;
use crate::domain::order::{NewOrderItem, OrderPageView, OrderView};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOrdersQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub order_id: Option<String>,
    pub status: Option<String>,
}

pub async fn list_orders(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<OrderPageView>>, AppError> {
    let page = state
        .list_orders
        .execute(
            &auth,
            query.page.unwrap_or(1),
            query.page_size.unwrap_or(10),
            query.order_id,
            query.status,
        )
        .await?;
    Ok(Json(ApiResponse::ok(page)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderRequest {
    pub order_id: String,
    pub status: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTime<Utc>>,
    pub items: Vec<CreateOrderItemRequest>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderItemRequest {
    pub product_id: String,
    pub quantity: i32,
}

pub async fn create_order(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateOrderRequest>,
) -> Result<Json<ApiResponse<OrderView>>, AppError> {
    let order = state
        .create_order
        .execute(
            &auth,
            CreateOrderCommand {
                order_id: body.order_id,
                status: body.status,
                carrier: body.carrier,
                tracking_number: body.tracking_number,
                estimated_delivery_at: body.estimated_delivery_at,
                items: body
                    .items
                    .into_iter()
                    .map(|i| NewOrderItem {
                        product_id: i.product_id.trim().to_uppercase(),
                        quantity: i.quantity,
                    })
                    .collect(),
            },
        )
        .await?;
    Ok(Json(ApiResponse::ok(order)))
}
