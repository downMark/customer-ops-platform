//! 领域事件与发布器 trait。事件只含标识/元数据，不含敏感订单字段（docs §10/§12）。

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Serialize;

/// `ConversationCompleted` 事件（对齐 docs §10.1）。camelCase 序列化。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCompleted {
    pub event_id: String,
    pub event_type: String,
    pub occurred_at: DateTime<Utc>,
    pub trace_id: String,
    pub conversation_id: String,
    pub order_id: String,
    pub schema_version: u32,
}

impl ConversationCompleted {
    pub const EVENT_TYPE: &'static str = "ConversationCompleted";
    pub const SCHEMA_VERSION: u32 = 1;

    /// 由完成记录构造事件；eventId 由 conversationId 派生以增强跨重试幂等。
    pub fn new(
        conversation_id: String,
        order_id: String,
        trace_id: String,
        occurred_at: DateTime<Utc>,
    ) -> Self {
        Self {
            event_id: format!("evt_{conversation_id}"),
            event_type: Self::EVENT_TYPE.to_string(),
            occurred_at,
            trace_id,
            conversation_id,
            order_id,
            schema_version: Self::SCHEMA_VERSION,
        }
    }
}

// 变体仅由 `sns` feature 的 SnsPublisher 与测试构造；默认 no-op 构建下不构造。
#[cfg_attr(not(feature = "sns"), allow(dead_code))]
#[derive(Debug)]
pub enum PublishError {
    /// SNS/网络不可用 → 上层 503（记录已落库，可安全重试）。
    Unavailable(String),
    /// 序列化等内部错误。
    Internal(String),
}

#[async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish(&self, event: &ConversationCompleted) -> Result<(), PublishError>;
}
