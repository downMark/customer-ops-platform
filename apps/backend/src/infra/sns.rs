//! 事件发布器实现：SNS（生产，`sns` feature）与 no-op（本地无 AWS，默认）。

use async_trait::async_trait;

use crate::domain::event::{ConversationCompleted, EventPublisher, PublishError};
// 仅 SnsPublisher（sns feature）用到；不加条件时默认构建会报 unused_imports。
#[cfg(feature = "sns")]
use crate::performance;

/// 生产用 SNS 发布器。仅在启用 `sns` feature 时编译。
#[cfg(feature = "sns")]
pub struct SnsPublisher {
    client: aws_sdk_sns::Client,
    topic_arn: String,
}

#[cfg(feature = "sns")]
impl SnsPublisher {
    /// 从环境（凭证/区域）构造。生产用 IAM Role/Secrets，不硬编码。
    pub async fn from_env(topic_arn: String) -> Self {
        let shared = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        Self {
            client: aws_sdk_sns::Client::new(&shared),
            topic_arn,
        }
    }
}

#[cfg(feature = "sns")]
#[async_trait]
impl EventPublisher for SnsPublisher {
    async fn publish(&self, event: &ConversationCompleted) -> Result<(), PublishError> {
        use aws_sdk_sns::types::MessageAttributeValue;
        let span = performance::client().start_span("sns.publish", None);

        let body =
            serde_json::to_string(event).map_err(|e| PublishError::Internal(e.to_string()))?;

        // 消息属性便于订阅端按 eventType 过滤（docs §10）。
        let event_type_attr = MessageAttributeValue::builder()
            .data_type("String")
            .string_value(&event.event_type)
            .build()
            .map_err(|e| PublishError::Internal(e.to_string()))?;

        self.client
            .publish()
            .topic_arn(&self.topic_arn)
            .message(body)
            .message_attributes("eventType", event_type_attr)
            .send()
            .await
            .map_err(|e| PublishError::Unavailable(e.to_string()))?;
        span.finish("ok");
        Ok(())
    }
}

/// 本地/无 AWS 时的兜底：只记日志，不外发。
pub struct NoopPublisher;

#[async_trait]
impl EventPublisher for NoopPublisher {
    async fn publish(&self, event: &ConversationCompleted) -> Result<(), PublishError> {
        tracing::info!(
            event_id = %event.event_id,
            event_type = %event.event_type,
            trace_id = %event.trace_id,
            "noop publish (SNS disabled)"
        );
        Ok(())
    }
}
