//! 本地运行时：环境加载、日志、监听端口和优雅关闭。

use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::{build_app, Config, StartupError};

pub(crate) async fn run() -> Result<(), StartupError> {
    // 本地读取 .env；生产环境由运行平台注入配置。
    let _ = dotenvy::dotenv();
    init_tracing();

    let config = Config::from_env()?;
    let app = build_app(&config).await?;
    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;

    tracing::info!(port = config.port, "backend listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
