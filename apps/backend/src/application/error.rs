//! 应用层错误：收敛仓储和事件发布错误，不依赖 HTTP/Axum。

use crate::domain::event::PublishError;
use crate::domain::repository::RepoError;

#[derive(Debug)]
pub enum ApplicationError {
    Unauthorized,
    InvalidRequest,
    Forbidden,
    NotFound,
    ServiceUnavailable,
    Internal(String),
}

impl From<RepoError> for ApplicationError {
    fn from(error: RepoError) -> Self {
        match error {
            RepoError::Unavailable => Self::ServiceUnavailable,
            RepoError::Other(detail) => Self::Internal(detail),
        }
    }
}

impl From<PublishError> for ApplicationError {
    fn from(error: PublishError) -> Self {
        match error {
            PublishError::Unavailable(_) => Self::ServiceUnavailable,
            PublishError::Internal(detail) => Self::Internal(detail),
        }
    }
}
