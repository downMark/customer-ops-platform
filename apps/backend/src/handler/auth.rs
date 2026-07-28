//! `POST /api/auth/login` — 校验账号密码并签发 JWT。

use axum::extract::rejection::JsonRejection;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::application::login::{LoginCommand, LoginView};
use crate::domain::auth::AuthUser;
use crate::response::{ApiResponse, AppError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

pub async fn validate(_user: AuthUser) -> StatusCode {
    StatusCode::NO_CONTENT
}

pub async fn login(
    State(state): State<AppState>,
    payload: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<LoginView>>, AppError> {
    let Json(payload) = payload.map_err(|_| AppError::InvalidRequest)?;
    let view = state
        .login
        .execute(LoginCommand {
            username: payload.username,
            password: payload.password,
        })
        .await?;
    Ok(Json(ApiResponse::ok(view)))
}
