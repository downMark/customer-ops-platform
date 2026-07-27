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
    /// 允许直接调用 Backend 的前端 Origin，逗号分隔。
    pub cors_origins: Vec<String>,
    /// SNS Topic ARN；缺省则用 no-op 发布器（本地无 AWS）。
    pub sns_topic_arn: Option<String>,
    pub operations_table_name: Option<String>,
    pub quality_queue_url: Option<String>,
    pub analytics_queue_url: Option<String>,
    pub quality_dlq_url: Option<String>,
    pub analytics_dlq_url: Option<String>,
    pub operations_alarm_names: Vec<String>,
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
        let optional = |key| env::var(key).ok().filter(|value| !value.trim().is_empty());
        let operations_alarm_names = env::var("OPERATIONS_ALARM_NAMES")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect();
        let cors_origins = env::var("CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3002".into())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(str::to_owned)
            .collect();
        Ok(Self {
            database_url,
            jwt_secret,
            jwt_ttl_seconds,
            port,
            db_max_connections,
            db_connect_timeout_secs,
            cors_origins,
            sns_topic_arn,
            operations_table_name: optional("OPERATIONS_TABLE_NAME"),
            quality_queue_url: optional("QUALITY_QUEUE_URL"),
            analytics_queue_url: optional("ANALYTICS_QUEUE_URL"),
            quality_dlq_url: optional("QUALITY_DLQ_URL"),
            analytics_dlq_url: optional("ANALYTICS_DLQ_URL"),
            operations_alarm_names,
        })
    }
}

fn required(key: &'static str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => Err(ConfigError::Missing(key)),
    }
}
