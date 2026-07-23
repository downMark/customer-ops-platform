//! 用例：查询某用户有权访问的订单。
//! 区分 404（不存在）/ 403（存在但非本人）/ 503（依赖不可用），均不泄露他人订单数据。

use std::sync::Arc;

use crate::domain::auth::AuthUser;
use crate::domain::order::OrderView;
use crate::domain::repository::OrderRepository;

use super::error::ApplicationError;

pub struct GetOrder {
    repo: Arc<dyn OrderRepository>,
}

impl GetOrder {
    pub fn new(repo: Arc<dyn OrderRepository>) -> Self {
        Self { repo }
    }

    pub async fn execute(
        &self,
        auth: &AuthUser,
        order_id: &str,
    ) -> Result<OrderView, ApplicationError> {
        // 归属命中 → 返回最小字段视图。
        if let Some(order) = self.repo.find_owned(order_id, &auth.user_id).await? {
            return Ok(order.into_view());
        }
        // 未命中归属：存在则无权（403），不存在则未找到（404）。
        if self.repo.exists(order_id).await? {
            return Err(ApplicationError::Forbidden);
        }
        Err(ApplicationError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::order::Order;
    use crate::domain::repository::RepoError;
    use async_trait::async_trait;
    use chrono::Utc;

    struct FakeRepo {
        owned: bool,
        exists: bool,
        unavailable: bool,
    }

    #[async_trait]
    impl OrderRepository for FakeRepo {
        async fn find_owned(&self, _o: &str, _u: &str) -> Result<Option<Order>, RepoError> {
            if self.unavailable {
                return Err(RepoError::Unavailable);
            }
            Ok(self.owned.then(sample))
        }
        async fn exists(&self, _o: &str) -> Result<bool, RepoError> {
            if self.unavailable {
                return Err(RepoError::Unavailable);
            }
            Ok(self.exists)
        }
    }

    fn sample() -> Order {
        Order {
            order_id: "COP-10086".into(),
            status: "shipped".into(),
            status_text: "已发货".into(),
            carrier: None,
            tracking_number: None,
            estimated_delivery_at: None,
            updated_at: Utc::now(),
        }
    }

    fn auth() -> AuthUser {
        AuthUser {
            user_id: "test-user-1".into(),
        }
    }

    fn uc(owned: bool, exists: bool, unavailable: bool) -> GetOrder {
        GetOrder::new(Arc::new(FakeRepo {
            owned,
            exists,
            unavailable,
        }))
    }

    #[tokio::test]
    async fn returns_view_when_owned() {
        let view = uc(true, true, false)
            .execute(&auth(), "COP-10086")
            .await
            .unwrap();
        assert_eq!(view.order_id, "COP-10086");
    }

    #[tokio::test]
    async fn forbidden_when_exists_but_not_owned() {
        let err = uc(false, true, false).execute(&auth(), "x").await;
        assert!(matches!(err, Err(ApplicationError::Forbidden)));
    }

    #[tokio::test]
    async fn not_found_when_absent() {
        let err = uc(false, false, false).execute(&auth(), "x").await;
        assert!(matches!(err, Err(ApplicationError::NotFound)));
    }

    #[tokio::test]
    async fn service_unavailable_on_repo_unavailable() {
        let err = uc(false, false, true).execute(&auth(), "x").await;
        assert!(matches!(err, Err(ApplicationError::ServiceUnavailable)));
    }
}
