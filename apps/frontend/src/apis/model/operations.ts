export interface TopicStatus {
  name: string;
  exists: boolean;
  confirmedSubscriptions: number;
}

export interface QueueMetrics {
  visible: number;
  inFlight: number;
  delayed: number;
  oldestMessageAgeSeconds: number | null;
}

export interface QueueStatus {
  key: "quality" | "analytics" | "qualityDlq" | "analyticsDlq";
  name: string;
  deadLetterQueue: boolean;
  maxReceiveCount: number | null;
  metrics: QueueMetrics;
}

export interface AlarmStatus {
  name: string;
  state: "OK" | "ALARM" | "INSUFFICIENT_DATA" | string;
}

export interface FailureTestStatus {
  testId: string;
  status:
    | "active"
    | "failing"
    | "in_dlq"
    | "recovered"
    | "completed"
    | "failed"
    | string;
  createdAt: string;
  qualityRedriveTask: string | null;
  analyticsRedriveTask: string | null;
}

export interface AwsStatus {
  topic: TopicStatus;
  queues: QueueStatus[];
  alarms: AlarmStatus[];
  failureTest: FailureTestStatus | null;
  refreshedAt: string;
}

export interface FailureTestAccepted {
  testId: string;
  status: string;
}

export interface RecoveryAccepted extends FailureTestAccepted {
  qualityRedriveTask: string | null;
  analyticsRedriveTask: string | null;
}
