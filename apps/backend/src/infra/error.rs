//! 基础设施错误映射。

use sea_orm::DbErr;

use crate::domain::repository::RepoError;

/// 保持现有语义：连接/获取连接失败视为不可用，其他数据库错误视为内部错误。
pub(crate) fn map_db_err(error: DbErr) -> RepoError {
    match error {
        DbErr::Conn(_) | DbErr::ConnectionAcquire(_) => RepoError::Unavailable,
        other => RepoError::Other(other.to_string()),
    }
}
