//! 统一响应封装 `{code,success,msg,data}` 与集中式错误映射。
//! 约定：`code=200`（`success=true`）为成功；失败 `data=null`，错误码见 `AppError`。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::application::error::ApplicationError;

/// 所有 JSON 接口的统一响应体。
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub code: i32,
    pub success: bool,
    pub msg: String,
    pub data: Option<T>,
}

impl<T> ApiResponse<T> {
    /// 成功响应，`code=200`。
    pub fn ok(data: T) -> Self {
        Self {
            code: 200,
            success: true,
            msg: "ok".to_string(),
            data: Some(data),
        }
    }
}

impl<T: Serialize> IntoResponse for ApiResponse<T> {
    fn into_response(self) -> Response {
        // 成功路径 HTTP 状态恒为 200；失败一律经 AppError 生成。
        (StatusCode::OK, Json(self)).into_response()
    }
}

/// 领域/边界错误。集中映射到 (HTTP 状态, 业务码, 展示文案)。
/// 文案面向人且脱敏，不泄露内部细节与他人订单数据。
#[derive(Debug)]
pub enum AppError {
    /// 请求体不是合法 JSON 或字段类型错误。
    InvalidRequest,
    /// token 缺失/无效/过期。
    Unauthorized,
    /// 订单存在但不属于当前用户。
    Forbidden,
    /// 订单不存在。
    NotFound,
    /// 唯一资源已经存在。
    Conflict,
    ProductUnavailable,
    InsufficientStock,
    ProductConflict,
    AdminRequired,
    /// 数据库/上游不可用或超时（不猜测订单状态）。
    ServiceUnavailable,
    /// 未预期的内部错误；detail 只进日志，不返回客户端。
    Internal(String),
}

impl AppError {
    fn parts(&self) -> (StatusCode, i32, &'static str) {
        match self {
            AppError::InvalidRequest => (StatusCode::BAD_REQUEST, 40001, "请求参数错误"),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, 40101, "未授权"),
            AppError::Forbidden => (StatusCode::FORBIDDEN, 40301, "无权访问该订单"),
            AppError::NotFound => (StatusCode::NOT_FOUND, 40401, "订单不存在"),
            AppError::Conflict => (StatusCode::CONFLICT, 40901, "订单号已存在"),
            AppError::ProductUnavailable => (StatusCode::BAD_REQUEST, 40002, "商品不存在或已停用"),
            AppError::InsufficientStock => (StatusCode::CONFLICT, 40902, "商品库存不足"),
            AppError::ProductConflict => (StatusCode::CONFLICT, 40903, "商品编号已存在"),
            AppError::AdminRequired => (StatusCode::FORBIDDEN, 40302, "仅管理员可执行该操作"),
            AppError::ServiceUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, 50301, "订单服务暂时不可用")
            }
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, 50000, "服务内部错误"),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (_, code, msg) = self.parts();
        write!(f, "AppError(code={code}, msg={msg})")
    }
}

impl std::error::Error for AppError {}

impl From<ApplicationError> for AppError {
    fn from(error: ApplicationError) -> Self {
        match error {
            ApplicationError::Unauthorized => Self::Unauthorized,
            ApplicationError::InvalidRequest => Self::InvalidRequest,
            ApplicationError::Forbidden => Self::Forbidden,
            ApplicationError::NotFound => Self::NotFound,
            ApplicationError::Conflict => Self::Conflict,
            ApplicationError::ProductUnavailable => Self::ProductUnavailable,
            ApplicationError::InsufficientStock => Self::InsufficientStock,
            ApplicationError::ProductConflict => Self::ProductConflict,
            ApplicationError::AdminRequired => Self::AdminRequired,
            ApplicationError::ServiceUnavailable => Self::ServiceUnavailable,
            ApplicationError::Internal(detail) => Self::Internal(detail),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, msg) = self.parts();
        // 内部错误细节只记日志，绝不透传客户端。
        if let AppError::Internal(detail) = &self {
            tracing::error!(error.code = code, error.detail = %detail, "internal error");
        } else if let AppError::ServiceUnavailable = &self {
            tracing::warn!(error.code = code, "dependency unavailable");
        }
        let body = ApiResponse::<()> {
            code,
            success: false,
            msg: msg.to_string(),
            data: None,
        };
        (status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_status_and_code_mapping() {
        let cases = [
            (AppError::InvalidRequest, StatusCode::BAD_REQUEST, 40001),
            (AppError::Unauthorized, StatusCode::UNAUTHORIZED, 40101),
            (AppError::Forbidden, StatusCode::FORBIDDEN, 40301),
            (AppError::NotFound, StatusCode::NOT_FOUND, 40401),
            (AppError::Conflict, StatusCode::CONFLICT, 40901),
            (
                AppError::ServiceUnavailable,
                StatusCode::SERVICE_UNAVAILABLE,
                50301,
            ),
            (
                AppError::Internal("x".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
                50000,
            ),
        ];
        for (err, status, code) in cases {
            let (s, c, _) = err.parts();
            assert_eq!(s, status);
            assert_eq!(c, code);
            assert_eq!(err.into_response().status(), status);
        }
    }

    #[test]
    fn ok_envelope_shape() {
        let r = ApiResponse::ok(42);
        assert_eq!(r.code, 200);
        assert!(r.success);
        assert_eq!(r.msg, "ok");
        assert_eq!(r.data, Some(42));
    }
}
