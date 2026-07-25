//! 订单领域模型与对外视图（最小字段）。

use chrono::{DateTime, Utc};
use serde::Serialize;

/// 订单领域模型（仅在服务内部流转）。归属校验在仓储层（SQL）完成，故此处不携带 user_id。
#[derive(Debug, Clone)]
pub struct Order {
    pub order_id: String,
    pub status: String,
    pub status_text: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub items: Vec<OrderItem>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    pub product_id: String,
    pub product_name: String,
    pub unit_price_cents: i64,
    pub quantity: i32,
    pub subtotal_cents: i64,
}

impl Order {
    /// 收敛为对外最小字段视图（不含 user_id 等归属/敏感信息）。
    pub fn into_view(self) -> OrderView {
        OrderView {
            order_id: self.order_id,
            status: self.status,
            status_text: self.status_text,
            carrier: self.carrier,
            tracking_number: self.tracking_number,
            estimated_delivery_at: self.estimated_delivery_at,
            updated_at: self.updated_at,
            product_summary: self
                .items
                .iter()
                .map(|i| format!("{} ×{}", i.product_name, i.quantity))
                .collect::<Vec<_>>()
                .join("、"),
            total_amount_cents: self.items.iter().map(|i| i.subtotal_cents).sum(),
            items: self.items,
        }
    }
}

/// 对外响应的订单视图，camelCase，时间为 RFC3339。
/// 仅暴露回答当前问题所需字段（docs §6.2）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderView {
    pub order_id: String,
    pub status: String,
    pub status_text: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub items: Vec<OrderItem>,
    pub product_summary: String,
    pub total_amount_cents: i64,
}

#[derive(Debug, Clone, Default)]
pub struct OrderFilter {
    pub order_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewOrder {
    pub order_id: String,
    pub status: String,
    pub status_text: String,
    pub carrier: Option<String>,
    pub tracking_number: Option<String>,
    pub estimated_delivery_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub items: Vec<NewOrderItem>,
}
#[derive(Debug, Clone)]
pub struct NewOrderItem {
    pub product_id: String,
    pub quantity: i32,
}

impl NewOrder {
    pub fn into_order(self) -> Order {
        Order {
            order_id: self.order_id,
            status: self.status,
            status_text: self.status_text,
            carrier: self.carrier,
            tracking_number: self.tracking_number,
            estimated_delivery_at: self.estimated_delivery_at,
            updated_at: self.updated_at,
            items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderPageView {
    pub items: Vec<OrderView>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
    pub total_pages: u64,
}

pub fn status_text(status: &str) -> Option<&'static str> {
    match status {
        "pending_payment" => Some("待付款"),
        "paid" => Some("已付款"),
        "processing" => Some("处理中"),
        "shipped" => Some("已发货"),
        "in_transit" => Some("运输中"),
        "out_for_delivery" => Some("派送中"),
        "delivered" => Some("已签收"),
        "cancelled" => Some("已取消"),
        "refund_pending" => Some("退款审核中"),
        "refunding" => Some("退款处理中"),
        "refunded" => Some("已退款"),
        "return_pending" => Some("退货审核中"),
        "returning" => Some("退货运输中"),
        "after_sale" => Some("售后处理中"),
        "delivery_exception" => Some("物流异常"),
        "completed" => Some("交易完成"),
        _ => None,
    }
}
