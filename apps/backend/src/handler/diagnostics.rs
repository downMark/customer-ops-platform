//! `POST /api/diagnostics/errors` —— 管理员专用的错误上报演练。
//!
//! 用途：在不等待线上真实故障的前提下，验证「backend 捕获 → performance SDK →
//! CloudWatch → Kinesis → cleaner → S3 → Sentry」这条链路是否打通。
//!
//! 与真实错误的区分：所有演练事件的 operation 一律以 `diagnostics.` 开头，
//! 同步器会把 operation 映射成 Sentry tag，因此可以用 `!operation:diagnostics.*`
//! 把演练数据从查询和告警条件中排除，不会污染真实故障的统计。

use axum::extract::{Extension, State};
use axum::Json;
use customer_ops_performance::TraceContext;
use serde::Deserialize;

use crate::domain::auth::AuthUser;
use crate::handler::middleware::TraceId;
use crate::performance;
use crate::response::AppError;
use crate::state::AppState;

/// 演练类型。每一种对应线上真实存在的一类故障，便于在 Sentry 里比对分组是否符合预期。
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticsKind {
    /// 业务侧可预期的失败，返回 404。
    NotFound,
    /// 数据库/上游不可用，返回 503。
    ServiceUnavailable,
    /// 上游超时，返回 503。
    Timeout,
    /// 未预期的内部错误，返回 500。
    Internal,
}

impl DiagnosticsKind {
    /// Sentry 里的 issue 标题来自这里，取值要稳定，改动会导致历史 issue 断开分组。
    fn error_type(self) -> &'static str {
        match self {
            Self::NotFound => "DiagnosticsNotFound",
            Self::ServiceUnavailable => "DiagnosticsServiceUnavailable",
            Self::Timeout => "DiagnosticsUpstreamTimeout",
            Self::Internal => "DiagnosticsInternalError",
        }
    }

    fn operation(self) -> &'static str {
        match self {
            Self::NotFound => "diagnostics.not_found",
            Self::ServiceUnavailable => "diagnostics.service_unavailable",
            Self::Timeout => "diagnostics.timeout",
            Self::Internal => "diagnostics.internal",
        }
    }

    fn app_error(self) -> AppError {
        match self {
            Self::NotFound => AppError::NotFound,
            Self::ServiceUnavailable | Self::Timeout => AppError::ServiceUnavailable,
            Self::Internal => AppError::Internal("diagnostics drill".into()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TriggerDiagnosticsRequest {
    kind: DiagnosticsKind,
    /// 防止误触：必须显式确认，与 failure-tests 的约定保持一致。
    confirmation: String,
}

const CONFIRMATION: &str = "TRIGGER_ERROR_DRILL";

/// 触发一次后端错误上报演练。
///
/// 事件先发出，再返回对应的 HTTP 错误：演练的目的就是产生一次真实形态的失败，
/// 这样前端自检页那侧也能同时观察到错误响应，与线上故障时的表现一致。
/// 因此成功路径不存在，返回类型固定为 `AppError`。
pub async fn trigger_error(
    auth: AuthUser,
    State(_state): State<AppState>,
    trace: Option<axum::extract::Extension<TraceId>>,
    Json(request): Json<TriggerDiagnosticsRequest>,
) -> AppError {
    if let Err(error) = require_admin(&auth) {
        return error;
    }
    if request.confirmation != CONFIRMATION {
        return AppError::InvalidRequest;
    }

    let kind = request.kind;
    let context = trace.map(|Extension(TraceId(id))| TraceContext {
        trace_id: id,
        span_id: String::new(),
        sampled: true,
    });
    performance::client().capture_error(
        kind.operation(),
        kind.error_type(),
        Some("diagnostics"),
        context.as_ref(),
    );
    tracing::warn!(
        operation = kind.operation(),
        error_type = kind.error_type(),
        "diagnostics error drill triggered"
    );

    kind.app_error()
}

fn require_admin(auth: &AuthUser) -> Result<(), AppError> {
    if auth.role == "admin" {
        Ok(())
    } else {
        Err(AppError::AdminRequired)
    }
}
