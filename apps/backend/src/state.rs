//! 应用共享状态，注入 Router。

use std::sync::Arc;

use crate::application::complete_conversation::CompleteConversation;
use crate::application::get_order::GetOrder;
use crate::application::login::Login;
use crate::domain::auth::TokenVerifier;

#[derive(Clone)]
pub struct AppState {
    pub(crate) get_order: Arc<GetOrder>,
    pub(crate) complete_conversation: Arc<CompleteConversation>,
    pub(crate) login: Arc<Login>,
    pub(crate) verifier: Arc<dyn TokenVerifier>,
}

impl AppState {
    pub fn new(
        get_order: Arc<GetOrder>,
        complete_conversation: Arc<CompleteConversation>,
        login: Arc<Login>,
        verifier: Arc<dyn TokenVerifier>,
    ) -> Self {
        Self {
            get_order,
            complete_conversation,
            login,
            verifier,
        }
    }
}
