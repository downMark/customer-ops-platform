//! 从环境变量加载配置。缺失关键项直接报错，不使用不安全默认。

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_ttl_seconds: u64,
    pub port: u16,
    pub db_max_connections: u32,
    pub db_connect_timeout_secs: u64,
    /// SNS Topic ARN；缺省则用 no-op 发布器（本地无 AWS）。
    pub sns_topic_arn: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("缺少必需环境变量: {0}")]
    Missing(&'static str),
    #[error("环境变量 {0} 格式非法")]
    Invalid(&'static str),
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = required("DATABASE_URL")?;
        let jwt_secret = required("AUTH_JWT_SECRET")?;
        let jwt_ttl_seconds = env::var("AUTH_JWT_TTL_SECONDS")
            .ok()
            .map(|value| {
                value
                    .parse::<u64>()
                    .ok()
                    .filter(|ttl| *ttl > 0)
                    .ok_or(ConfigError::Invalid("AUTH_JWT_TTL_SECONDS"))
            })
            .transpose()?
            .unwrap_or(86_400);
        let port = env::var("PORT")
            .ok()
            .map(|v| v.parse::<u16>().map_err(|_| ConfigError::Invalid("PORT")))
            .transpose()?
            .unwrap_or(8080);
        // Lambda + Neon pooler 下建议小池；本地默认 5。
        let db_max_connections = env::var("DB_MAX_CONNECTIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let db_connect_timeout_secs = env::var("DB_CONNECT_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let sns_topic_arn = env::var("SNS_TOPIC_ARN")
            .ok()
            .filter(|v| !v.trim().is_empty());
        Ok(Self {
            database_url,
            jwt_secret,
            jwt_ttl_seconds,
            port,
            db_max_connections,
            db_connect_timeout_secs,
            sns_topic_arn,
        })
    }
}

fn required(key: &'static str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => Err(ConfigError::Missing(key)),
    }
}
