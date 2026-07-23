//! 用例：记录对话完成并发布领域事件。
//! 顺序：先幂等持久化 → 再发布（最终一致）；已存在则跳过发布，发布失败可安全重试。

use std::sync::Arc;

use chrono::Utc;
use serde::Serialize;

use crate::domain::conversation::{ConversationCompletion, ConversationRepository, SaveOutcome};
use crate::domain::event::{ConversationCompleted, EventPublisher};

use super::error::ApplicationError;

pub struct CompleteConversation {
    repo: Arc<dyn ConversationRepository>,
    publisher: Arc<dyn EventPublisher>,
}

/// 完成命令（conversationId 取自 path，orderId 取自 body，traceId 取自请求上下文）。
pub struct CompleteCommand {
    pub conversation_id: String,
    pub order_id: String,
    pub trace_id: String,
}

/// 对外视图。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionView {
    pub conversation_id: String,
    pub published: bool,
}

impl CompleteConversation {
    pub fn new(repo: Arc<dyn ConversationRepository>, publisher: Arc<dyn EventPublisher>) -> Self {
        Self { repo, publisher }
    }

    pub async fn execute(&self, cmd: CompleteCommand) -> Result<CompletionView, ApplicationError> {
        let occurred_at = Utc::now();
        let record = ConversationCompletion {
            conversation_id: cmd.conversation_id.clone(),
            order_id: cmd.order_id.clone(),
            trace_id: cmd.trace_id.clone(),
            occurred_at,
        };

        match self.repo.save_once(&record).await? {
            // 重复请求：不再发布，避免重复副作用。
            SaveOutcome::AlreadyExists => Ok(CompletionView {
                conversation_id: cmd.conversation_id,
                published: false,
            }),
            SaveOutcome::Inserted => {
                let event = ConversationCompleted::new(
                    cmd.conversation_id.clone(),
                    cmd.order_id,
                    cmd.trace_id,
                    occurred_at,
                );
                self.publisher.publish(&event).await?;
                Ok(CompletionView {
                    conversation_id: cmd.conversation_id,
                    published: true,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::event::PublishError;
    use crate::domain::repository::RepoError;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeRepo {
        outcome: SaveOutcome,
        unavailable: bool,
    }

    #[async_trait]
    impl ConversationRepository for FakeRepo {
        async fn save_once(&self, _rec: &ConversationCompletion) -> Result<SaveOutcome, RepoError> {
            if self.unavailable {
                return Err(RepoError::Unavailable);
            }
            Ok(self.outcome)
        }
    }

    struct FakePublisher {
        calls: AtomicUsize,
        fail: bool,
    }

    impl FakePublisher {
        fn new(fail: bool) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                fail,
            }
        }
    }

    #[async_trait]
    impl EventPublisher for FakePublisher {
        async fn publish(&self, _event: &ConversationCompleted) -> Result<(), PublishError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err(PublishError::Unavailable("boom".into()))
            } else {
                Ok(())
            }
        }
    }

    fn cmd() -> CompleteCommand {
        CompleteCommand {
            conversation_id: "conv_123".into(),
            order_id: "COP-10086".into(),
            trace_id: "trace_1".into(),
        }
    }

    #[tokio::test]
    async fn inserted_publishes_once() {
        let publisher = Arc::new(FakePublisher::new(false));
        let uc = CompleteConversation::new(
            Arc::new(FakeRepo {
                outcome: SaveOutcome::Inserted,
                unavailable: false,
            }),
            publisher.clone(),
        );
        let view = uc.execute(cmd()).await.unwrap();
        assert!(view.published);
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn already_exists_skips_publish() {
        let publisher = Arc::new(FakePublisher::new(false));
        let uc = CompleteConversation::new(
            Arc::new(FakeRepo {
                outcome: SaveOutcome::AlreadyExists,
                unavailable: false,
            }),
            publisher.clone(),
        );
        let view = uc.execute(cmd()).await.unwrap();
        assert!(!view.published);
        assert_eq!(publisher.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn publish_failure_maps_service_unavailable() {
        let uc = CompleteConversation::new(
            Arc::new(FakeRepo {
                outcome: SaveOutcome::Inserted,
                unavailable: false,
            }),
            Arc::new(FakePublisher::new(true)),
        );
        assert!(matches!(
            uc.execute(cmd()).await,
            Err(ApplicationError::ServiceUnavailable)
        ));
    }

    #[tokio::test]
    async fn repo_unavailable_maps_service_unavailable() {
        let uc = CompleteConversation::new(
            Arc::new(FakeRepo {
                outcome: SaveOutcome::Inserted,
                unavailable: true,
            }),
            Arc::new(FakePublisher::new(false)),
        );
        assert!(matches!(
            uc.execute(cmd()).await,
            Err(ApplicationError::ServiceUnavailable)
        ));
    }

    #[test]
    fn event_shape() {
        let e = ConversationCompleted::new(
            "conv_123".into(),
            "COP-10086".into(),
            "trace_1".into(),
            Utc::now(),
        );
        assert_eq!(e.event_id, "evt_conv_123");
        assert_eq!(e.event_type, "ConversationCompleted");
        assert_eq!(e.schema_version, 1);
    }
}
