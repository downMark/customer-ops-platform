//! 应用共享状态，注入 Router。

use std::sync::Arc;

use crate::application::complete_conversation::CompleteConversation;
use crate::application::create_order::CreateOrder;
use crate::application::get_order::GetOrder;
use crate::application::list_orders::ListOrders;
use crate::application::login::Login;
use crate::application::products::Products;
use crate::domain::auth::TokenVerifier;

#[derive(Clone)]
pub struct AppState {
    pub(crate) get_order: Arc<GetOrder>,
    pub(crate) list_orders: Arc<ListOrders>,
    pub(crate) create_order: Arc<CreateOrder>,
    pub(crate) complete_conversation: Arc<CompleteConversation>,
    pub(crate) login: Arc<Login>,
    pub(crate) verifier: Arc<dyn TokenVerifier>,
    pub(crate) products: Arc<Products>,
}

impl AppState {
    pub fn new(
        get_order: Arc<GetOrder>,
        list_orders: Arc<ListOrders>,
        create_order: Arc<CreateOrder>,
        complete_conversation: Arc<CompleteConversation>,
        login: Arc<Login>,
        verifier: Arc<dyn TokenVerifier>,
        products: Arc<Products>,
    ) -> Self {
        Self {
            get_order,
            list_orders,
            create_order,
            complete_conversation,
            login,
            verifier,
            products,
        }
    }
}
