//! customer-ops-backend 应用库。
//! 提供可复用的应用与 Router 构造入口，供本地 Axum、测试及 Lambda 入口共享。

pub mod application;
mod bootstrap;
pub mod config;
pub mod domain;
mod handler;
mod infra;
mod migration;
mod performance;
pub mod response;
pub mod router;
mod runtime;
pub mod state;

use axum::Router;
use sea_orm::DbErr;
use sea_orm_migration::MigratorTrait;

pub use config::Config;

/// 应用启动阶段错误。只描述进程装配失败，不承担 HTTP 错误映射。
#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error(transparent)]
    Database(#[from] DbErr),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// 使用真实基础设施构造完整应用。
///
/// 数据库连接和迁移在此完成；返回的 Router 可由本地 TCP Server 或
/// `lambda_http` 入口直接复用。
pub async fn build_app(config: &Config) -> Result<Router, StartupError> {
    let state = bootstrap::build_state(config).await?;
    router::build_router_with_cors(state, &config.cors_origins)
}

/// 仅连接数据库并执行待应用的内联迁移，不启动 HTTP 服务。
pub async fn migrate_database(config: &Config) -> Result<(), StartupError> {
    let connection = infra::db::connect(config).await?;
    migration::Migrator::up(&connection, None).await?;
    Ok(())
}

/// 启动本地 Axum 服务。
pub async fn run() -> Result<(), StartupError> {
    runtime::run().await
}
