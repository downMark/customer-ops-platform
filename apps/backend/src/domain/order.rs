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
}
