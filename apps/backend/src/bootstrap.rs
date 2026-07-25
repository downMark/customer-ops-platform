//! 应用依赖装配：数据库、迁移、仓储、用例、鉴权与事件发布器。

use std::sync::Arc;

use sea_orm_migration::MigratorTrait;

use crate::application::complete_conversation::CompleteConversation;
use crate::application::create_order::CreateOrder;
use crate::application::get_order::GetOrder;
use crate::application::list_orders::ListOrders;
use crate::application::login::Login;
use crate::application::products::Products;
use crate::config::Config;
use crate::domain::event::EventPublisher;
use crate::infra::conversation_repo::SeaOrmConversationRepository;
use crate::infra::db;
use crate::infra::jwt::JwtVerifier;
use crate::infra::order_repo::SeaOrmOrderRepository;
use crate::infra::password::Argon2PasswordVerifier;
use crate::infra::product_repo::SeaOrmProductRepository;
use crate::infra::sns::NoopPublisher;
use crate::infra::user_repo::SeaOrmUserRepository;
use crate::migration::Migrator;
use crate::state::AppState;
use crate::StartupError;

pub(crate) async fn build_state(config: &Config) -> Result<AppState, StartupError> {
    let connection = db::connect(config).await?;
    Migrator::up(&connection, None).await?;

    let order_repo = Arc::new(SeaOrmOrderRepository::new(connection.clone()));
    let conversation_repo = Arc::new(SeaOrmConversationRepository::new(connection.clone()));
    let user_repo = Arc::new(SeaOrmUserRepository::new(connection.clone()));
    let product_repo = Arc::new(SeaOrmProductRepository::new(connection));
    let jwt = Arc::new(JwtVerifier::with_ttl(
        &config.jwt_secret,
        config.jwt_ttl_seconds,
    ));

    Ok(AppState::new(
        Arc::new(GetOrder::new(order_repo.clone())),
        Arc::new(ListOrders::new(order_repo.clone())),
        Arc::new(CreateOrder::new(order_repo)),
        Arc::new(CompleteConversation::new(
            conversation_repo,
            build_publisher(config).await,
        )),
        Arc::new(Login::new(
            user_repo,
            Arc::new(Argon2PasswordVerifier),
            jwt.clone(),
        )),
        jwt,
        Arc::new(Products::new(product_repo)),
    ))
}

/// 有 `SNS_TOPIC_ARN` 且启用 `sns` feature 时使用真实 SNS，否则回退 no-op。
async fn build_publisher(config: &Config) -> Arc<dyn EventPublisher> {
    match config.sns_topic_arn.clone() {
        #[cfg(feature = "sns")]
        Some(arn) => Arc::new(crate::infra::sns::SnsPublisher::from_env(arn).await),
        #[cfg(not(feature = "sns"))]
        Some(_) => {
            tracing::warn!("SNS_TOPIC_ARN 已配置但未启用 `sns` feature，回退 no-op（不外发事件）");
            Arc::new(NoopPublisher)
        }
        None => {
            tracing::warn!("SNS_TOPIC_ARN 未配置，使用 no-op 事件发布器");
            Arc::new(NoopPublisher)
        }
    }
}
