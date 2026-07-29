//! 鉴权 extractor 与 X-Trace-Id 中间件。

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::http::{HeaderValue, Request};
use axum::middleware::Next;
use axum::response::Response;
use customer_ops_performance::{format_traceparent, parse_traceparent};
use serde_json::Value;
use tracing::Instrument;
use uuid::Uuid;

use crate::domain::auth::AuthUser;
use crate::performance;
use crate::response::AppError;
use crate::state::AppState;

const TRACE_ID_HEADER: &str = "x-trace-id";
const TRACEPARENT_HEADER: &str = "traceparent";

/// 请求级 trace id，注入 extensions 供 handler 读取。
#[derive(Debug, Clone)]
pub struct TraceId(pub String);

/// 从 `Authorization: Bearer <token>` 解析并校验身份。
/// 失败即 `AppError::Unauthorized`（IntoResponse 生成统一失败封装）。
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or(AppError::Unauthorized)?;
        state
            .verifier
            .verify(token)
            .map_err(|_| AppError::Unauthorized)
    }
}

/// 保证每个请求都有 trace id：请求带则沿用，未带则生成；写入 tracing span 与响应头。
pub async fn trace_id(mut request: Request<axum::body::Body>, next: Next) -> Response {
    let method = request.method().as_str().to_string();
    let parent = request
        .headers()
        .get(TRACEPARENT_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_traceparent);
    let mut performance_span = performance::client().start_span("http.request", parent.as_ref());
    performance_span
        .attributes
        .insert("component".into(), Value::String("axum".into()));
    performance_span
        .attributes
        .insert("httpMethod".into(), Value::String(method));
    let trace_id = request
        .headers()
        .get(TRACE_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("trace_{}", Uuid::new_v4().simple()));

    // 供 handler 通过 Extension<TraceId> 读取。
    request.extensions_mut().insert(TraceId(trace_id.clone()));

    let span = tracing::info_span!("request", trace_id = %trace_id);
    let mut response = next.run(request).instrument(span).await;
    performance_span.attributes.insert(
        "httpStatusCode".into(),
        Value::Number(response.status().as_u16().into()),
    );
    let performance_context = performance_span.context.clone();
    performance_span.finish(if response.status().is_success() {
        "ok"
    } else {
        "error"
    });
    // Lambda freezes the execution environment as soon as the response is returned.
    // Drain the SDK worker first so error events reach CloudWatch Logs reliably.
    #[cfg(feature = "lambda")]
    performance::client().flush();

    if let Ok(value) = HeaderValue::from_str(&trace_id) {
        response.headers_mut().insert(TRACE_ID_HEADER, value);
    }
    if let Ok(value) = HeaderValue::from_str(&format_traceparent(&performance_context)) {
        response.headers_mut().insert(TRACEPARENT_HEADER, value);
    }
    response
}
