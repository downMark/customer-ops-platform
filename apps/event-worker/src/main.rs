use std::env;

use aws_sdk_dynamodb::types::AttributeValue;
use customer_ops_performance::PerformanceClient;
use lambda_runtime::{service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CURRENT_TEST_KEY: &str = "CURRENT";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqsEvent {
    #[serde(default, rename = "Records")]
    records: Vec<SqsRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqsRecord {
    message_id: Option<String>,
    body: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailureTestEvent {
    event_type: String,
    test_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchResponse {
    batch_item_failures: Vec<BatchItemFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchItemFailure {
    item_identifier: String,
}

#[derive(Clone)]
struct Worker {
    dynamodb: aws_sdk_dynamodb::Client,
    table_name: String,
    performance: PerformanceClient,
}

impl Worker {
    async fn process(&self, event: SqsEvent) -> BatchResponse {
        let batch_size = event.records.len();
        let batch_span = self.performance.start_span("sqs.batch", None);
        let mut failures = Vec::new();
        for record in event.records {
            let record_span = self
                .performance
                .start_span("sqs.record", Some(&batch_span.context));
            let message_id = record.message_id.unwrap_or_default();
            let Some(body) = record.body else {
                tracing::warn!(%message_id, "discarding SQS record without a body");
                record_span.finish("error");
                continue;
            };
            match serde_json::from_str::<FailureTestEvent>(&body) {
                Ok(test) if test.event_type == "operations.failure_test" => {
                    match self.should_fail(&test.test_id).await {
                        Ok(true) => {
                            tracing::warn!(
                                %message_id,
                                test.id = %test.test_id,
                                "controlled failure drill is active"
                            );
                            failures.push(BatchItemFailure {
                                item_identifier: message_id,
                            });
                            record_span.finish("error");
                        }
                        Ok(false) => {
                            tracing::info!(
                                %message_id,
                                test.id = %test.test_id,
                                "recovered failure drill event consumed"
                            );
                            record_span.finish("ok");
                        }
                        Err(error) => {
                            tracing::error!(%message_id, %error, "failed to read drill state");
                            failures.push(BatchItemFailure {
                                item_identifier: message_id,
                            });
                            record_span.finish("error");
                        }
                    }
                }
                Ok(_) => {
                    tracing::info!(%message_id, "non-poison operations event consumed");
                    record_span.finish("ok");
                }
                Err(_) => {
                    let parsed = serde_json::from_str::<Value>(&body);
                    if parsed.is_ok() {
                        tracing::info!(%message_id, "domain event consumed");
                        record_span.finish("ok");
                    } else {
                        // Invalid payloads must be visible in the DLQ instead of disappearing.
                        tracing::warn!(%message_id, "invalid JSON event will be retried");
                        failures.push(BatchItemFailure {
                            item_identifier: message_id,
                        });
                        record_span.finish("error");
                    }
                }
            }
        }
        let failed = failures.len();
        let mut measurements = serde_json::Map::new();
        measurements.insert("batchSize".into(), Value::from(batch_size as u64));
        measurements.insert("count".into(), Value::from(failed as u64));
        self.performance
            .record_metric("sqs.batch.result", measurements);
        batch_span.finish(if failed > 0 { "error" } else { "ok" });
        // The Lambda runtime may freeze immediately after this future resolves.
        self.performance.flush();
        BatchResponse {
            batch_item_failures: failures,
        }
    }

    async fn should_fail(&self, test_id: &str) -> Result<bool, aws_sdk_dynamodb::Error> {
        let output = self
            .dynamodb
            .get_item()
            .table_name(&self.table_name)
            .key("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
            .consistent_read(true)
            .send()
            .await
            .map_err(aws_sdk_dynamodb::Error::from)?;
        let item = output.item.unwrap_or_default();
        let current_id = item
            .get("exercise_id")
            .and_then(|value| value.as_s().ok())
            .map(String::as_str);
        let status = item
            .get("status")
            .and_then(|value| value.as_s().ok())
            .map(String::as_str);
        Ok(current_id == Some(test_id) && status == Some("active"))
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,customer_ops_event_worker=info".into()),
        )
        .without_time()
        .init();
    let table_name = env::var("OPERATIONS_TABLE_NAME")
        .map_err(|_| "OPERATIONS_TABLE_NAME must be configured")?;
    let shared = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let worker = Worker {
        dynamodb: aws_sdk_dynamodb::Client::new(&shared),
        table_name,
        performance: PerformanceClient::new(
            "event-worker",
            env::var("APP_ENVIRONMENT").unwrap_or_else(|_| "local".into()),
            env::var("APP_RELEASE").unwrap_or_else(|_| "development".into()),
        ),
    };
    lambda_runtime::run(service_fn(move |event: LambdaEvent<SqsEvent>| {
        let worker = worker.clone();
        async move { Ok::<_, Error>(worker.process(event.payload).await) }
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_uses_lambda_partial_batch_shape() {
        let value = serde_json::to_value(BatchResponse {
            batch_item_failures: vec![BatchItemFailure {
                item_identifier: "message-1".into(),
            }],
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "batchItemFailures": [{"itemIdentifier": "message-1"}]
            })
        );
    }
}
