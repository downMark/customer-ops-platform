//! AWS 运行状态和受控故障演练边界。

use async_trait::async_trait;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicStatus {
    pub name: String,
    pub exists: bool,
    pub confirmed_subscriptions: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueMetrics {
    pub visible: i64,
    pub in_flight: i64,
    pub delayed: i64,
    pub oldest_message_age_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub key: String,
    pub name: String,
    pub dead_letter_queue: bool,
    pub max_receive_count: Option<u32>,
    pub metrics: QueueMetrics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmStatus {
    pub name: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureTestStatus {
    pub test_id: String,
    pub status: String,
    pub created_at: String,
    pub quality_redrive_task: Option<String>,
    pub analytics_redrive_task: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsStatus {
    pub topic: TopicStatus,
    pub queues: Vec<QueueStatus>,
    pub alarms: Vec<AlarmStatus>,
    pub failure_test: Option<FailureTestStatus>,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureTestAccepted {
    pub test_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryAccepted {
    pub test_id: String,
    pub status: String,
    pub quality_redrive_task: Option<String>,
    pub analytics_redrive_task: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum OperationsError {
    #[error("operations integration is not configured")]
    NotConfigured,
    #[error("a failure test is already active or a DLQ is not empty")]
    Conflict,
    #[error("failure test was not found")]
    NotFound,
    #[error("AWS operations dependency failed: {0}")]
    Dependency(String),
}

#[async_trait]
pub trait Operations: Send + Sync {
    async fn status(&self) -> Result<AwsStatus, OperationsError>;
    async fn trigger_failure_test(&self) -> Result<FailureTestAccepted, OperationsError>;
    async fn recover_failure_test(
        &self,
        test_id: &str,
    ) -> Result<RecoveryAccepted, OperationsError>;
}

pub struct UnavailableOperations;

#[async_trait]
impl Operations for UnavailableOperations {
    async fn status(&self) -> Result<AwsStatus, OperationsError> {
        Err(OperationsError::NotConfigured)
    }

    async fn trigger_failure_test(&self) -> Result<FailureTestAccepted, OperationsError> {
        Err(OperationsError::NotConfigured)
    }

    async fn recover_failure_test(
        &self,
        _test_id: &str,
    ) -> Result<RecoveryAccepted, OperationsError> {
        Err(OperationsError::NotConfigured)
    }
}
