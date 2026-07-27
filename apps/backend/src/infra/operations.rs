//! AWS SDK implementation for the read-only status page and controlled DLQ drill.

use std::collections::HashMap;
use std::time::Duration as StdDuration;

use async_trait::async_trait;
use aws_sdk_cloudwatch::types::{Dimension, Statistic};
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_sqs::types::QueueAttributeName;
use chrono::{Duration, SecondsFormat, Utc};
use uuid::Uuid;

use crate::config::Config;
use crate::domain::operations::{
    AlarmStatus, AwsStatus, FailureTestAccepted, FailureTestStatus, Operations, OperationsError,
    QueueMetrics, QueueStatus, RecoveryAccepted, TopicStatus,
};

const CURRENT_TEST_KEY: &str = "CURRENT";

#[derive(Clone)]
pub struct AwsOperations {
    sns: aws_sdk_sns::Client,
    sqs: aws_sdk_sqs::Client,
    dynamodb: aws_sdk_dynamodb::Client,
    cloudwatch: aws_sdk_cloudwatch::Client,
    topic_arn: String,
    table_name: String,
    queues: QueueUrls,
    alarm_names: Vec<String>,
}

#[derive(Clone)]
struct QueueUrls {
    quality: String,
    analytics: String,
    quality_dlq: String,
    analytics_dlq: String,
}

impl AwsOperations {
    pub async fn from_env(config: &Config) -> Option<Self> {
        let topic_arn = config.sns_topic_arn.clone()?;
        let table_name = config.operations_table_name.clone()?;
        let queues = QueueUrls {
            quality: config.quality_queue_url.clone()?,
            analytics: config.analytics_queue_url.clone()?,
            quality_dlq: config.quality_dlq_url.clone()?,
            analytics_dlq: config.analytics_dlq_url.clone()?,
        };
        let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .retry_config(aws_config::retry::RetryConfig::standard().with_max_attempts(2))
            .timeout_config(
                aws_config::timeout::TimeoutConfig::builder()
                    .operation_timeout(StdDuration::from_secs(3))
                    .operation_attempt_timeout(StdDuration::from_millis(1_500))
                    .build(),
            )
            .load()
            .await;
        Some(Self {
            sns: aws_sdk_sns::Client::new(&shared),
            sqs: aws_sdk_sqs::Client::new(&shared),
            dynamodb: aws_sdk_dynamodb::Client::new(&shared),
            cloudwatch: aws_sdk_cloudwatch::Client::new(&shared),
            topic_arn,
            table_name,
            queues,
            alarm_names: config.operations_alarm_names.clone(),
        })
    }

    async fn queue_status(
        &self,
        key: &str,
        queue_url: &str,
        dead_letter_queue: bool,
        max_receive_count: Option<u32>,
    ) -> Result<QueueStatus, OperationsError> {
        let output = self
            .sqs
            .get_queue_attributes()
            .queue_url(queue_url)
            .attribute_names(QueueAttributeName::QueueArn)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessages)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessagesNotVisible)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessagesDelayed)
            .send()
            .await
            .map_err(dependency)?;
        let attrs = output.attributes.unwrap_or_default();
        let queue_arn = attrs
            .get(&QueueAttributeName::QueueArn)
            .map(String::as_str)
            .unwrap_or_default();
        let name = queue_arn
            .rsplit(':')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown")
            .to_string();
        let value = |name: QueueAttributeName| {
            attrs
                .get(&name)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0)
        };
        let oldest_message_age_seconds = self.oldest_message_age(&name).await;
        Ok(QueueStatus {
            key: key.to_string(),
            name,
            dead_letter_queue,
            max_receive_count,
            metrics: QueueMetrics {
                visible: value(QueueAttributeName::ApproximateNumberOfMessages),
                in_flight: value(QueueAttributeName::ApproximateNumberOfMessagesNotVisible),
                delayed: value(QueueAttributeName::ApproximateNumberOfMessagesDelayed),
                oldest_message_age_seconds,
            },
        })
    }

    async fn oldest_message_age(&self, queue_name: &str) -> Option<f64> {
        let end = Utc::now();
        let start = end - Duration::minutes(10);
        self.cloudwatch
            .get_metric_statistics()
            .namespace("AWS/SQS")
            .metric_name("ApproximateAgeOfOldestMessage")
            .dimensions(
                Dimension::builder()
                    .name("QueueName")
                    .value(queue_name)
                    .build(),
            )
            .start_time(aws_smithy_types::DateTime::from_secs(start.timestamp()))
            .end_time(aws_smithy_types::DateTime::from_secs(end.timestamp()))
            .period(60)
            .statistics(Statistic::Maximum)
            .send()
            .await
            .ok()?
            .datapoints
            .unwrap_or_default()
            .into_iter()
            .filter_map(|point| point.maximum)
            .max_by(f64::total_cmp)
    }

    async fn current_test(&self) -> Result<Option<FailureTestStatus>, OperationsError> {
        let output = self
            .dynamodb
            .get_item()
            .table_name(&self.table_name)
            .key("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
            .consistent_read(true)
            .send()
            .await
            .map_err(dependency)?;
        Ok(output.item.map(parse_test))
    }

    async fn topic_status(&self) -> Result<TopicStatus, OperationsError> {
        let topic = self
            .sns
            .get_topic_attributes()
            .topic_arn(&self.topic_arn)
            .send()
            .await
            .map_err(dependency)?;
        let attrs = topic.attributes.unwrap_or_default();
        Ok(TopicStatus {
            name: self
                .topic_arn
                .rsplit(':')
                .next()
                .unwrap_or("domain-events")
                .to_string(),
            exists: true,
            confirmed_subscriptions: attrs
                .get("SubscriptionsConfirmed")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
        })
    }

    async fn queue_statuses(&self) -> Result<Vec<QueueStatus>, OperationsError> {
        let (quality, analytics, quality_dlq, analytics_dlq) = tokio::try_join!(
            self.queue_status("quality", &self.queues.quality, false, Some(5)),
            self.queue_status("analytics", &self.queues.analytics, false, Some(5)),
            self.queue_status("qualityDlq", &self.queues.quality_dlq, true, None),
            self.queue_status("analyticsDlq", &self.queues.analytics_dlq, true, None),
        )?;
        Ok(vec![quality, analytics, quality_dlq, analytics_dlq])
    }

    async fn alarm_statuses(&self) -> Result<Vec<AlarmStatus>, OperationsError> {
        if self.alarm_names.is_empty() {
            return Ok(Vec::new());
        }
        let response = self
            .cloudwatch
            .describe_alarms()
            .set_alarm_names(Some(self.alarm_names.clone()))
            .send()
            .await
            .map_err(dependency)?;
        Ok(response
            .metric_alarms
            .unwrap_or_default()
            .into_iter()
            .map(|alarm| AlarmStatus {
                name: alarm.alarm_name.unwrap_or_else(|| "unknown".into()),
                state: alarm
                    .state_value
                    .map(|state| state.as_str().to_string())
                    .unwrap_or_else(|| "UNKNOWN".into()),
            })
            .collect())
    }

    async fn queue_arn(&self, queue_url: &str) -> Result<String, OperationsError> {
        self.sqs
            .get_queue_attributes()
            .queue_url(queue_url)
            .attribute_names(QueueAttributeName::QueueArn)
            .send()
            .await
            .map_err(dependency)?
            .attributes
            .and_then(|attrs| attrs.get(&QueueAttributeName::QueueArn).cloned())
            .ok_or_else(|| OperationsError::Dependency("queue ARN is missing".into()))
    }

    async fn start_redrive(
        &self,
        source_url: &str,
        destination_url: &str,
    ) -> Result<String, OperationsError> {
        let source_arn = self.queue_arn(source_url).await?;
        let destination_arn = self.queue_arn(destination_url).await?;
        let existing = self
            .sqs
            .list_message_move_tasks()
            .source_arn(&source_arn)
            .max_results(1)
            .send()
            .await
            .map_err(dependency)?;
        if let Some(handle) = existing
            .results()
            .iter()
            .find(|task| task.status() == Some("RUNNING"))
            .and_then(|task| task.task_handle())
        {
            return Ok(handle.to_string());
        }
        self.sqs
            .start_message_move_task()
            .source_arn(source_arn)
            .destination_arn(destination_arn)
            .send()
            .await
            .map_err(dependency)?
            .task_handle
            .ok_or_else(|| OperationsError::Dependency("redrive task handle is missing".into()))
    }

    async fn store_task_handle(
        &self,
        test_id: &str,
        field: &str,
        task_handle: &str,
    ) -> Result<(), OperationsError> {
        self.dynamodb
            .update_item()
            .table_name(&self.table_name)
            .key("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
            .update_expression(format!("SET {field} = :handle"))
            .condition_expression("exercise_id = :exercise_id")
            .expression_attribute_values(":handle", AttributeValue::S(task_handle.into()))
            .expression_attribute_values(":exercise_id", AttributeValue::S(test_id.into()))
            .send()
            .await
            .map_err(dependency)?;
        Ok(())
    }
}

#[async_trait]
impl Operations for AwsOperations {
    async fn status(&self) -> Result<AwsStatus, OperationsError> {
        let (topic, queues, alarms, mut failure_test) = tokio::try_join!(
            self.topic_status(),
            self.queue_statuses(),
            self.alarm_statuses(),
            self.current_test(),
        )?;
        if let Some(test) = failure_test.as_mut() {
            if test.status == "active" {
                let dlqs_ready = queues
                    .iter()
                    .filter(|queue| queue.dead_letter_queue)
                    .all(|queue| queue.metrics.visible > 0);
                if dlqs_ready {
                    test.status = "in_dlq".into();
                } else {
                    test.status = "failing".into();
                }
            } else if test.status == "recovered"
                && queues.iter().all(|queue| {
                    queue.metrics.visible == 0
                        && queue.metrics.in_flight == 0
                        && queue.metrics.delayed == 0
                })
            {
                test.status = "completed".into();
            }
        }

        Ok(AwsStatus {
            topic,
            queues,
            alarms,
            failure_test,
            refreshed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        })
    }

    async fn trigger_failure_test(&self) -> Result<FailureTestAccepted, OperationsError> {
        let status = self.status().await?;
        if status.queues.iter().any(|queue| {
            queue.dead_letter_queue
                && (queue.metrics.visible > 0
                    || queue.metrics.in_flight > 0
                    || queue.metrics.delayed > 0)
        }) || status.failure_test.as_ref().is_some_and(|test| {
            matches!(
                test.status.as_str(),
                "active" | "failing" | "in_dlq" | "recovering"
            )
        }) {
            return Err(OperationsError::Conflict);
        }

        let test_id = Uuid::new_v4().to_string();
        let created_at = Utc::now();
        let ttl = (created_at + Duration::days(7)).timestamp();
        self.dynamodb
            .put_item()
            .table_name(&self.table_name)
            .item("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
            .item("exercise_id", AttributeValue::S(test_id.clone()))
            .item("status", AttributeValue::S("active".into()))
            .item(
                "created_at",
                AttributeValue::S(created_at.to_rfc3339_opts(SecondsFormat::Secs, true)),
            )
            .item("expires_at", AttributeValue::N(ttl.to_string()))
            .condition_expression(
                "attribute_not_exists(test_id) OR #status IN (:completed, :recovered, :failed)",
            )
            .expression_attribute_names("#status", "status")
            .expression_attribute_values(":completed", AttributeValue::S("completed".into()))
            .expression_attribute_values(":recovered", AttributeValue::S("recovered".into()))
            .expression_attribute_values(":failed", AttributeValue::S("failed".into()))
            .send()
            .await
            .map_err(|error| {
                if error
                    .as_service_error()
                    .is_some_and(|service| service.is_conditional_check_failed_exception())
                {
                    OperationsError::Conflict
                } else {
                    dependency(error)
                }
            })?;

        let payload = serde_json::json!({
            "eventType": "operations.failure_test",
            "testId": test_id,
            "occurredAt": created_at.to_rfc3339_opts(SecondsFormat::Secs, true)
        });
        if let Err(error) = self
            .sns
            .publish()
            .topic_arn(&self.topic_arn)
            .message(payload.to_string())
            .send()
            .await
        {
            let _ = self
                .dynamodb
                .update_item()
                .table_name(&self.table_name)
                .key("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
                .update_expression("SET #status = :failed")
                .expression_attribute_names("#status", "status")
                .expression_attribute_values(":failed", AttributeValue::S("failed".into()))
                .send()
                .await;
            return Err(dependency(error));
        }

        Ok(FailureTestAccepted {
            test_id,
            status: "active".into(),
        })
    }

    async fn recover_failure_test(
        &self,
        test_id: &str,
    ) -> Result<RecoveryAccepted, OperationsError> {
        let current = self
            .current_test()
            .await?
            .filter(|test| test.test_id == test_id)
            .ok_or(OperationsError::NotFound)?;
        self.dynamodb
            .update_item()
            .table_name(&self.table_name)
            .key("test_id", AttributeValue::S(CURRENT_TEST_KEY.into()))
            .update_expression("SET #status = :recovered")
            .condition_expression("exercise_id = :exercise_id")
            .expression_attribute_names("#status", "status")
            .expression_attribute_values(":recovered", AttributeValue::S("recovered".into()))
            .expression_attribute_values(":exercise_id", AttributeValue::S(test_id.into()))
            .send()
            .await
            .map_err(dependency)?;

        let quality_task = match current.quality_redrive_task {
            Some(handle) => Some(handle),
            None => {
                let handle = self
                    .start_redrive(&self.queues.quality_dlq, &self.queues.quality)
                    .await?;
                self.store_task_handle(test_id, "quality_redrive_task", &handle)
                    .await?;
                Some(handle)
            }
        };
        let analytics_task = match current.analytics_redrive_task {
            Some(handle) => Some(handle),
            None => {
                let handle = self
                    .start_redrive(&self.queues.analytics_dlq, &self.queues.analytics)
                    .await?;
                self.store_task_handle(test_id, "analytics_redrive_task", &handle)
                    .await?;
                Some(handle)
            }
        };

        Ok(RecoveryAccepted {
            test_id: test_id.into(),
            status: "recovered".into(),
            quality_redrive_task: quality_task,
            analytics_redrive_task: analytics_task,
        })
    }
}

fn parse_test(item: HashMap<String, AttributeValue>) -> FailureTestStatus {
    let string = |key: &str| {
        item.get(key)
            .and_then(|value| value.as_s().ok())
            .cloned()
            .unwrap_or_default()
    };
    let optional = |key: &str| {
        item.get(key)
            .and_then(|value| value.as_s().ok())
            .filter(|value| !value.is_empty())
            .cloned()
    };
    FailureTestStatus {
        test_id: string("exercise_id"),
        status: string("status"),
        created_at: string("created_at"),
        quality_redrive_task: optional("quality_redrive_task"),
        analytics_redrive_task: optional("analytics_redrive_task"),
    }
}

fn dependency(error: impl std::fmt::Display) -> OperationsError {
    OperationsError::Dependency(error.to_string())
}
