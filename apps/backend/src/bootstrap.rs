//! 应用依赖装配：数据库、迁移、仓储、用例、鉴权与事件发布器。

use std::sync::Arc;

use sea_orm_migration::MigratorTrait;

use crate::application::complete_conversation::CompleteConversation;
use crate::application::create_order::CreateOrder;
use crate::application::get_order::GetOrder;
use crate::application::list_orders::ListOrders;
use crate::application::login::Login;
use crate::application::products::Products;
use crate::application::search_knowledge::SearchKnowledge;
use crate::config::Config;
use crate::domain::event::EventPublisher;
use crate::domain::operations::{Operations, UnavailableOperations};
use crate::infra::conversation_repo::SeaOrmConversationRepository;
use crate::infra::db;
use crate::infra::jwt::JwtVerifier;
use crate::infra::knowledge_repo::SeaOrmKnowledgeRepository;
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
    let knowledge_repo = Arc::new(SeaOrmKnowledgeRepository::new(connection.clone()));
    let product_repo = Arc::new(SeaOrmProductRepository::new(connection));
    let jwt = Arc::new(JwtVerifier::with_ttl(
        &config.jwt_secret,
        config.jwt_ttl_seconds,
    ));
    let operations = build_operations(config).await;

    Ok(AppState {
        get_order: Arc::new(GetOrder::new(order_repo.clone())),
        list_orders: Arc::new(ListOrders::new(order_repo.clone())),
        create_order: Arc::new(CreateOrder::new(order_repo)),
        complete_conversation: Arc::new(CompleteConversation::new(
            conversation_repo,
            build_publisher(config).await,
        )),
        login: Arc::new(Login::new(
            user_repo,
            Arc::new(Argon2PasswordVerifier),
            jwt.clone(),
        )),
        verifier: jwt,
        products: Arc::new(Products::new(product_repo)),
        search_knowledge: Arc::new(SearchKnowledge::new(knowledge_repo)),
        operations,
    })
}

// config 只在 ops feature 下被读取，默认构建时用 `_` 前缀避免 unused_variables。
async fn build_operations(
    #[cfg_attr(not(feature = "ops"), allow(unused_variables))] config: &Config,
) -> Arc<dyn Operations> {
    #[cfg(feature = "ops")]
    if let Some(operations) = crate::infra::operations::AwsOperations::from_env(config).await {
        return Arc::new(operations);
    }
    tracing::warn!("AWS operations integration is not configured");
    Arc::new(UnavailableOperations)
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
