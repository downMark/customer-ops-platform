//! Authenticated AWS operations status and administrator-only failure drills.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{response::IntoResponse, Json};
use serde::Deserialize;

use crate::domain::auth::AuthUser;
use crate::domain::operations::{
    AwsStatus, FailureTestAccepted, OperationsError, RecoveryAccepted,
};
use crate::response::{ApiResponse, AppError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct TriggerFailureTestRequest {
    confirmation: String,
}

pub async fn status(
    _auth: AuthUser,
    State(state): State<AppState>,
) -> Result<ApiResponse<AwsStatus>, AppError> {
    state
        .operations
        .status()
        .await
        .map(ApiResponse::ok)
        .map_err(map_error)
}

pub async fn trigger_failure_test(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(request): Json<TriggerFailureTestRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_admin(&auth)?;
    if request.confirmation != "TRIGGER_DLQ_TEST" {
        return Err(AppError::InvalidRequest);
    }
    let accepted: FailureTestAccepted = state
        .operations
        .trigger_failure_test()
        .await
        .map_err(map_error)?;
    Ok((StatusCode::ACCEPTED, Json(ApiResponse::ok(accepted))))
}

pub async fn recover_failure_test(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(test_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_admin(&auth)?;
    let accepted: RecoveryAccepted = state
        .operations
        .recover_failure_test(&test_id)
        .await
        .map_err(map_error)?;
    Ok((StatusCode::ACCEPTED, Json(ApiResponse::ok(accepted))))
}

fn require_admin(auth: &AuthUser) -> Result<(), AppError> {
    if auth.role == "admin" {
        Ok(())
    } else {
        Err(AppError::AdminRequired)
    }
}

fn map_error(error: OperationsError) -> AppError {
    match error {
        OperationsError::Conflict => AppError::OperationsConflict,
        OperationsError::NotFound => AppError::OperationsNotFound,
        OperationsError::NotConfigured | OperationsError::Dependency(_) => {
            tracing::warn!(error = %error, "AWS operations request failed");
            AppError::OperationsUnavailable
        }
    }
}
