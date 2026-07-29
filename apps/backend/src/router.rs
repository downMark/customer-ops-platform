//! HTTP 路由与全局中间件集中配置。

use std::time::Duration;

use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::handler;
use crate::state::AppState;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// 构造不依赖具体运行时的应用 Router。
pub fn build_router(state: AppState) -> Router {
    build_base_router(state)
}

/// 构造带精确 Origin 白名单的生产 Router。
pub fn build_router_with_cors(
    state: AppState,
    origins: &[String],
) -> Result<Router, crate::StartupError> {
    let allowed_origins = origins
        .iter()
        .map(|origin| {
            HeaderValue::from_str(origin).map_err(|_| {
                crate::StartupError::Config(crate::config::ConfigError::Invalid("CORS_ORIGINS"))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::HeaderName::from_static("x-trace-id"),
            header::HeaderName::from_static("traceparent"),
            header::HeaderName::from_static("tracestate"),
        ])
        .expose_headers([
            header::HeaderName::from_static("x-trace-id"),
            header::HeaderName::from_static("traceparent"),
        ]);

    Ok(build_base_router(state).layer(cors))
}

fn build_base_router(state: AppState) -> Router {
    Router::new()
        .route("/api/auth/login", post(handler::auth::login))
        .route("/api/auth/validate", get(handler::auth::validate))
        .route(
            "/api/products",
            get(handler::products::list).post(handler::products::create),
        )
        .route(
            "/api/orders",
            get(handler::orders::list_orders).post(handler::orders::create_order),
        )
        .route("/api/orders/{order_id}", get(handler::orders::get_order))
        .route(
            "/api/conversations/{conversation_id}/complete",
            post(handler::conversations::complete_conversation),
        )
        .route("/api/knowledge/search", post(handler::knowledge::search))
        .route("/api/ops/aws-status", get(handler::operations::status))
        .route(
            "/api/ops/failure-tests",
            post(handler::operations::trigger_failure_test),
        )
        .route(
            "/api/ops/failure-tests/{test_id}/recover",
            post(handler::operations::recover_failure_test),
        )
        .route(
            "/api/diagnostics/errors",
            post(handler::diagnostics::trigger_error),
        )
        .route("/api/health", get(handler::health::health))
        .layer(axum::middleware::from_fn(handler::middleware::trace_id))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;
    use axum::body::Body;
    use axum::http::{Method, Request};
    use chrono::{TimeZone, Utc};
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::*;
    use crate::application::complete_conversation::CompleteConversation;
    use crate::application::create_order::CreateOrder;
    use crate::application::get_order::GetOrder;
    use crate::application::list_orders::ListOrders;
    use crate::application::login::Login;
    use crate::application::products::Products;
    use crate::application::search_knowledge::SearchKnowledge;
    use crate::domain::auth::{
        AuthError, AuthServiceError, AuthUser, IssuedToken, PasswordVerifier, TokenIssuer,
        TokenVerifier,
    };
    use crate::domain::conversation::{
        ConversationCompletion, ConversationRepository, SaveOutcome,
    };
    use crate::domain::event::{ConversationCompleted, EventPublisher, PublishError};
    use crate::domain::knowledge::{KnowledgeChunk, KnowledgeFilter, KnowledgeRepository};
    use crate::domain::operations::{
        AwsStatus, FailureTestAccepted, Operations, OperationsError, QueueMetrics, QueueStatus,
        RecoveryAccepted, TopicStatus,
    };
    use crate::domain::order::{NewOrder, Order, OrderFilter, OrderItem};
    use crate::domain::product::Product;
    use crate::domain::repository::{OrderRepository, ProductRepository, RepoError};
    use crate::domain::user::{UserAccount, UserRepository};

    struct FakeOrderRepository;

    #[async_trait]
    impl OrderRepository for FakeOrderRepository {
        async fn find_owned(
            &self,
            order_id: &str,
            user_id: &str,
        ) -> Result<Option<Order>, RepoError> {
            let owned = (matches!(order_id, "COP-10086" | "ORD-2026-0001")
                && user_id == "test-user-1")
                || (order_id == "ADMIN-2026-0001" && user_id == "test-operator");
            if !owned {
                return Ok(None);
            }
            let (status, status_text) = if order_id == "ORD-2026-0001" {
                ("pending_payment", "待付款")
            } else {
                ("shipped", "已发货")
            };
            Ok(Some(Order {
                order_id: order_id.to_string(),
                status: status.into(),
                status_text: status_text.into(),
                carrier: None,
                tracking_number: None,
                estimated_delivery_at: None,
                updated_at: Utc
                    .with_ymd_and_hms(2026, 7, 22, 12, 0, 0)
                    .single()
                    .expect("valid test timestamp"),
                items: vec![OrderItem {
                    product_id: "PROD-001".into(),
                    product_name: "演示商品".into(),
                    unit_price_cents: 19_900,
                    quantity: 1,
                    subtotal_cents: 19_900,
                }],
            }))
        }

        async fn exists(&self, order_id: &str) -> Result<bool, RepoError> {
            Ok(matches!(order_id, "COP-10086" | "ADMIN-2026-0001"))
        }

        async fn list_owned(
            &self,
            user_id: &str,
            _filter: &OrderFilter,
            _offset: u64,
            _limit: u64,
        ) -> Result<(Vec<Order>, u64), RepoError> {
            let order = self.find_owned("COP-10086", user_id).await?;
            let items = order.into_iter().collect::<Vec<_>>();
            let total = items.len() as u64;
            Ok((items, total))
        }

        async fn create_owned(&self, _user_id: &str, order: &NewOrder) -> Result<bool, RepoError> {
            if order.items.iter().any(|item| item.product_id == "PROD-OOS") {
                return Err(RepoError::InsufficientStock);
            }
            if order
                .items
                .iter()
                .any(|item| item.product_id == "PROD-MISSING")
            {
                return Err(RepoError::InvalidReference);
            }
            Ok(true)
        }
    }

    struct FakeConversationRepository;

    #[async_trait]
    impl ConversationRepository for FakeConversationRepository {
        async fn save_once(
            &self,
            _record: &ConversationCompletion,
        ) -> Result<SaveOutcome, RepoError> {
            Ok(SaveOutcome::Inserted)
        }
    }

    struct FakePublisher;

    #[async_trait]
    impl EventPublisher for FakePublisher {
        async fn publish(&self, _event: &ConversationCompleted) -> Result<(), PublishError> {
            Ok(())
        }
    }

    struct FakeOperations;

    #[async_trait]
    impl Operations for FakeOperations {
        async fn status(&self) -> Result<AwsStatus, OperationsError> {
            Ok(AwsStatus {
                topic: TopicStatus {
                    name: "customer-ops-production-domain-events".into(),
                    exists: true,
                    confirmed_subscriptions: 2,
                },
                queues: vec![QueueStatus {
                    key: "quality".into(),
                    name: "customer-ops-production-quality".into(),
                    dead_letter_queue: false,
                    max_receive_count: Some(5),
                    metrics: QueueMetrics {
                        visible: 0,
                        in_flight: 0,
                        delayed: 0,
                        oldest_message_age_seconds: None,
                    },
                }],
                alarms: vec![],
                failure_test: None,
                refreshed_at: "2026-07-27T12:00:00Z".into(),
            })
        }

        async fn trigger_failure_test(&self) -> Result<FailureTestAccepted, OperationsError> {
            Ok(FailureTestAccepted {
                test_id: "test-drill-1".into(),
                status: "active".into(),
            })
        }

        async fn recover_failure_test(
            &self,
            test_id: &str,
        ) -> Result<RecoveryAccepted, OperationsError> {
            Ok(RecoveryAccepted {
                test_id: test_id.into(),
                status: "recovered".into(),
                quality_redrive_task: Some("quality-task".into()),
                analytics_redrive_task: Some("analytics-task".into()),
            })
        }
    }

    struct FakeVerifier;

    impl TokenVerifier for FakeVerifier {
        fn verify(&self, bearer_token: &str) -> Result<AuthUser, AuthError> {
            if bearer_token == "valid-token" {
                Ok(AuthUser {
                    user_id: "test-user-1".into(),
                    role: "operator".into(),
                })
            } else if bearer_token == "operator-token" {
                Ok(AuthUser {
                    user_id: "test-operator".into(),
                    role: "operator".into(),
                })
            } else if bearer_token == "admin-token" {
                Ok(AuthUser {
                    user_id: "test-admin".into(),
                    role: "admin".into(),
                })
            } else {
                Err(AuthError::InvalidToken)
            }
        }
    }
    struct FakeProductRepository;
    #[async_trait]
    impl ProductRepository for FakeProductRepository {
        async fn list(
            &self,
            _: Option<&str>,
            _: Option<bool>,
            _: u64,
            _: u64,
        ) -> Result<(Vec<Product>, u64), RepoError> {
            let now = Utc::now();
            Ok((
                vec![Product {
                    product_id: "PROD-001".into(),
                    name: "演示商品".into(),
                    price_cents: 19_900,
                    stock_quantity: 100,
                    is_active: true,
                    created_at: now,
                    updated_at: now,
                }],
                1,
            ))
        }

        async fn create(&self, product: &Product) -> Result<bool, RepoError> {
            Ok(product.product_id != "PROD-DUP")
        }
    }

    struct FakeKnowledgeRepository;

    #[async_trait]
    impl KnowledgeRepository for FakeKnowledgeRepository {
        async fn search(
            &self,
            _vector: &[f32],
            _top_k: u64,
            _filter: &KnowledgeFilter,
        ) -> Result<Vec<KnowledgeChunk>, RepoError> {
            Ok(vec![KnowledgeChunk {
                id: 1,
                document_id: "refrigerator-guide".into(),
                chunk_index: 0,
                content: "先检查冰箱电源和温控设置。".into(),
                source: "knowledge/appliances/refrigerator.md".into(),
                metadata: json!({
                    "productId": "PROD-006",
                    "category": "refrigerator"
                }),
                score: 0.91,
            }])
        }
    }

    struct FakeUserRepository;

    #[async_trait]
    impl UserRepository for FakeUserRepository {
        async fn find_by_username(&self, username: &str) -> Result<Option<UserAccount>, RepoError> {
            Ok((username == "test-operator").then(|| UserAccount {
                user_id: "test-operator".into(),
                username: "test-operator".into(),
                password_hash: "test-hash".into(),
                role: "operator".into(),
                is_active: true,
            }))
        }
    }

    struct FakePasswordVerifier;

    impl PasswordVerifier for FakePasswordVerifier {
        fn verify(&self, password: &str, _password_hash: &str) -> Result<bool, AuthServiceError> {
            Ok(password == "correct-password")
        }
    }

    struct FakeTokenIssuer;

    impl TokenIssuer for FakeTokenIssuer {
        fn issue(&self, _account: &UserAccount) -> Result<IssuedToken, AuthServiceError> {
            Ok(IssuedToken {
                access_token: "operator-token".into(),
                expires_in: 86_400,
            })
        }
    }

    fn test_router() -> Router {
        let order_repo = Arc::new(FakeOrderRepository);
        build_router(AppState {
            get_order: Arc::new(GetOrder::new(order_repo.clone())),
            list_orders: Arc::new(ListOrders::new(order_repo.clone())),
            create_order: Arc::new(CreateOrder::new(order_repo)),
            complete_conversation: Arc::new(CompleteConversation::new(
                Arc::new(FakeConversationRepository),
                Arc::new(FakePublisher),
            )),
            login: Arc::new(Login::new(
                Arc::new(FakeUserRepository),
                Arc::new(FakePasswordVerifier),
                Arc::new(FakeTokenIssuer),
            )),
            verifier: Arc::new(FakeVerifier),
            products: Arc::new(Products::new(Arc::new(FakeProductRepository))),
            search_knowledge: Arc::new(SearchKnowledge::new(Arc::new(FakeKnowledgeRepository))),
            operations: Arc::new(FakeOperations),
        })
    }

    async fn json_body(response: axum::response::Response) -> Value {
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("response body can be collected")
            .to_bytes();
        serde_json::from_slice(&bytes).expect("response body is JSON")
    }

    #[tokio::test]
    async fn health_route_preserves_trace_id_and_envelope() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .header("x-trace-id", "trace_test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-trace-id"], "trace_test");
        let body = json_body(response).await;
        assert_eq!(body["code"], 200);
        assert_eq!(body["data"]["status"], "ok");
    }

    #[tokio::test]
    async fn knowledge_search_validates_auth_and_returns_matches() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/knowledge/search")
                    .header("authorization", "Bearer valid-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "vector": vec![0.01_f32; 1024],
                            "topK": 20,
                            "filters": {"productId": "PROD-006"}
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["items"][0]["documentId"], "refrigerator-guide");
        assert_eq!(body["data"]["items"][0]["score"], 0.91);
    }

    #[tokio::test]
    async fn operations_status_is_authenticated_and_sanitized() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/ops/aws-status")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["topic"]["confirmedSubscriptions"], 2);
        assert_eq!(body["data"]["queues"][0]["maxReceiveCount"], 5);
        assert!(body.to_string().find("arn:aws").is_none());
    }

    #[tokio::test]
    async fn failure_drill_requires_admin_and_exact_confirmation() {
        let request = |token: &str, confirmation: &str| {
            Request::builder()
                .method(Method::POST)
                .uri("/api/ops/failure-tests")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"confirmation": confirmation}).to_string(),
                ))
                .unwrap()
        };
        let forbidden = test_router()
            .oneshot(request("valid-token", "TRIGGER_DLQ_TEST"))
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let invalid = test_router()
            .oneshot(request("admin-token", "TRIGGER"))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let accepted = test_router()
            .oneshot(request("admin-token", "TRIGGER_DLQ_TEST"))
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::ACCEPTED);
        assert_eq!(json_body(accepted).await["data"]["testId"], "test-drill-1");
    }

    #[tokio::test]
    async fn error_drill_requires_admin_and_maps_each_kind_to_a_real_failure() {
        let request = |token: &str, kind: &str, confirmation: &str| {
            Request::builder()
                .method(Method::POST)
                .uri("/api/diagnostics/errors")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"kind": kind, "confirmation": confirmation}).to_string(),
                ))
                .unwrap()
        };

        let forbidden = test_router()
            .oneshot(request("valid-token", "not_found", "TRIGGER_ERROR_DRILL"))
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let unconfirmed = test_router()
            .oneshot(request("admin-token", "not_found", "TRIGGER"))
            .await
            .unwrap();
        assert_eq!(unconfirmed.status(), StatusCode::BAD_REQUEST);

        // 演练必须产出真实形态的失败响应，前端自检页才能观察到与线上一致的表现。
        for (kind, expected) in [
            ("not_found", StatusCode::NOT_FOUND),
            ("service_unavailable", StatusCode::SERVICE_UNAVAILABLE),
            ("timeout", StatusCode::SERVICE_UNAVAILABLE),
            ("internal", StatusCode::INTERNAL_SERVER_ERROR),
        ] {
            let response = test_router()
                .oneshot(request("admin-token", kind, "TRIGGER_ERROR_DRILL"))
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "kind={kind}");
            let body = json_body(response).await;
            assert_eq!(body["success"], false);
            // 失败文案不得泄露内部细节。
            assert!(body["data"].is_null());
        }
    }

    #[tokio::test]
    async fn health_route_generates_trace_id() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(response.headers()["x-trace-id"]
            .to_str()
            .unwrap()
            .starts_with("trace_"));
    }

    #[tokio::test]
    async fn auth_validate_requires_a_valid_token() {
        let valid = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/validate")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(valid.status(), StatusCode::NO_CONTENT);

        let invalid = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/validate")
                    .header("authorization", "Bearer invalid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn order_route_returns_owned_order() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders/COP-10086")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["orderId"], "COP-10086");
        assert_eq!(body["data"]["statusText"], "已发货");
        assert_eq!(body["data"]["productSummary"], "演示商品 ×1");
        assert_eq!(body["data"]["totalAmountCents"], 19_900);
    }

    #[tokio::test]
    async fn order_list_route_returns_paginated_data() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders?page=1&pageSize=10&status=shipped")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["total"], 1);
        assert_eq!(body["data"]["page"], 1);
        assert_eq!(body["data"]["items"][0]["orderId"], "COP-10086");
    }

    #[tokio::test]
    async fn create_order_route_returns_created_order() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders")
                    .header("authorization", "Bearer valid-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "orderId": "ORD-2026-0001",
                            "status": "pending_payment",
                            "items": [{"productId":"PROD-001","quantity":1}]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["orderId"], "ORD-2026-0001");
        assert_eq!(body["data"]["statusText"], "待付款");
        assert_eq!(body["data"]["items"][0]["productId"], "PROD-001");
    }

    #[tokio::test]
    async fn create_order_rejects_duplicate_products() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders")
                    .header("authorization", "Bearer valid-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "orderId": "ORD-DUPLICATE",
                            "status": "pending_payment",
                            "items": [
                                {"productId":"PROD-001","quantity":1},
                                {"productId":"prod-001","quantity":2}
                            ]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(response).await["code"], 40903);
    }

    #[tokio::test]
    async fn create_order_maps_product_and_inventory_errors() {
        for (product_id, expected_status, expected_code) in [
            ("PROD-MISSING", StatusCode::BAD_REQUEST, 40002),
            ("PROD-OOS", StatusCode::CONFLICT, 40902),
        ] {
            let response = test_router()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/orders")
                        .header("authorization", "Bearer valid-token")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({
                                "orderId": format!("ORD-{product_id}"),
                                "status": "pending_payment",
                                "items": [{"productId":product_id,"quantity":1}]
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected_status);
            assert_eq!(json_body(response).await["code"], expected_code);
        }
    }

    #[tokio::test]
    async fn products_route_returns_paginated_products() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/products?page=1&pageSize=20&active=true")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["total"], 1);
        assert_eq!(body["data"]["items"][0]["productId"], "PROD-001");
        assert_eq!(body["data"]["items"][0]["priceCents"], 19_900);
    }

    #[tokio::test]
    async fn create_product_requires_admin_role() {
        let request = || {
            Request::builder()
                .method(Method::POST)
                .uri("/api/products")
                .header("authorization", "Bearer valid-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "productId": "PROD-NEW",
                        "name": "新商品",
                        "priceCents": 9900,
                        "stockQuantity": 20
                    })
                    .to_string(),
                ))
                .unwrap()
        };
        let response = test_router().oneshot(request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(json_body(response).await["code"], 40302);

        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/products")
                    .header("authorization", "Bearer admin-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "productId": "PROD-NEW",
                            "name": "新商品",
                            "priceCents": 9900,
                            "stockQuantity": 20
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await["data"]["productId"], "PROD-NEW");
    }

    #[tokio::test]
    async fn create_product_rejects_duplicate_product_id() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/products")
                    .header("authorization", "Bearer admin-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "productId": "PROD-DUP",
                            "name": "重复商品",
                            "priceCents": 9900,
                            "stockQuantity": 20
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(response).await["code"], 40903);
    }

    #[tokio::test]
    async fn login_token_can_query_owned_order() {
        let login_response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "username": "test-operator",
                            "password": "correct-password"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login_response.status(), StatusCode::OK);
        let login_body = json_body(login_response).await;
        assert_eq!(login_body["data"]["tokenType"], "Bearer");
        assert_eq!(login_body["data"]["expiresIn"], 86_400);
        assert_eq!(login_body["data"]["user"]["userId"], "test-operator");
        let token = login_body["data"]["accessToken"].as_str().unwrap();

        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders/ADMIN-2026-0001")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            json_body(response).await["data"]["orderId"],
            "ADMIN-2026-0001"
        );
    }

    #[tokio::test]
    async fn login_rejects_bad_credentials_without_account_disclosure() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "username": "test-operator",
                            "password": "wrong-password"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = json_body(response).await;
        assert_eq!(body["code"], 40101);
        assert_eq!(body["msg"], "未授权");
    }

    #[tokio::test]
    async fn order_route_rejects_missing_token_with_unified_error() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders/COP-10086")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = json_body(response).await;
        assert_eq!(body["code"], 40101);
        assert_eq!(body["success"], false);
        assert!(body["data"].is_null());
    }

    #[tokio::test]
    async fn order_route_rejects_invalid_token() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders/COP-10086")
                    .header("authorization", "Bearer invalid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(json_body(response).await["code"], 40101);
    }

    #[tokio::test]
    async fn order_route_maps_application_error_to_http_envelope() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/orders/UNKNOWN")
                    .header("authorization", "Bearer valid-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = json_body(response).await;
        assert_eq!(body["code"], 40401);
        assert_eq!(body["success"], false);
        assert!(body["data"].is_null());
    }

    #[tokio::test]
    async fn conversation_complete_route_keeps_existing_contract() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/conversations/conv_123/complete")
                    .header("authorization", "Bearer valid-token")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "orderId": "COP-10086" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["conversationId"], "conv_123");
        assert_eq!(body["data"]["published"], true);
    }

    #[tokio::test]
    async fn routes_keep_method_and_path_matching() {
        let response = test_router()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/conversations/conv_123/complete")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

        let response = test_router()
            .oneshot(
                Request::builder()
                    .uri("/api/unknown")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
