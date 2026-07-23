//! 对话完成记录领域模型与仓储 trait。

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::repository::RepoError;

/// 对话完成记录（保存后触发领域事件）。
#[derive(Debug, Clone)]
pub struct ConversationCompletion {
    pub conversation_id: String,
    pub order_id: String,
    pub trace_id: String,
    pub occurred_at: DateTime<Utc>,
}

/// 幂等保存结果：首次插入 or 已存在。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveOutcome {
    Inserted,
    AlreadyExists,
}

#[async_trait]
pub trait ConversationRepository: Send + Sync {
    /// 幂等保存（conversation_id 唯一 + on-conflict do nothing）。
    async fn save_once(&self, rec: &ConversationCompletion) -> Result<SaveOutcome, RepoError>;
}
