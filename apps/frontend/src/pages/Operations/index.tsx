import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import OperationsService from "apis/services/Operations";
import { QueueStatus } from "apis/model/operations";
import { AppOutletContext } from "components/layout/AppShell";
import Icon from "components/Icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const queueLabel: Record<string, string> = {
  quality: "质量分析主队列",
  analytics: "数据分析主队列",
  qualityDlq: "质量分析 DLQ",
  analyticsDlq: "数据分析 DLQ",
};

const testStep = (status?: string) => {
  switch (status) {
    case "active":
      return "已发布";
    case "failing":
      return "消费失败重试中";
    case "in_dlq":
      return "已进入 DLQ";
    case "recovered":
      return "Redrive 处理中";
    case "completed":
      return "恢复完成";
    case "failed":
      return "演练失败";
    default:
      return "暂无演练";
  }
};

const formatAge = (seconds: number | null) => {
  if (seconds == null) return "暂无数据";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
};

function QueueCard({ queue }: { queue: QueueStatus }) {
  const unhealthy =
    queue.deadLetterQueue &&
    (queue.metrics.visible > 0 || queue.metrics.inFlight > 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{queueLabel[queue.key] || queue.name}</CardTitle>
          <CardDescription className="mt-1 break-all">
            {queue.name}
          </CardDescription>
        </div>
        <Badge variant={unhealthy ? "destructive" : "secondary"}>
          {unhealthy ? "有死信" : "正常"}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-muted p-3">
            <dt className="text-muted-foreground">可见消息</dt>
            <dd className="mt-1 text-2xl font-bold">{queue.metrics.visible}</dd>
          </div>
          <div className="rounded-xl bg-muted p-3">
            <dt className="text-muted-foreground">处理中</dt>
            <dd className="mt-1 text-2xl font-bold">{queue.metrics.inFlight}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">延迟消息</dt>
            <dd className="font-bold">{queue.metrics.delayed}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">最老消息</dt>
            <dd className="font-bold">
              {formatAge(queue.metrics.oldestMessageAgeSeconds)}
            </dd>
          </div>
          {!queue.deadLetterQueue && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">进入 DLQ 前最大接收次数</dt>
              <dd className="font-bold">{queue.maxReceiveCount ?? "—"}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

export default function Operations() {
  const { session } = useOutletContext<AppOutletContext>();
  const queryClient = useQueryClient();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const status = useQuery({
    queryKey: ["aws-operations-status"],
    queryFn: OperationsService.status,
    refetchInterval: 15_000,
    retry: 1,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["aws-operations-status"] });
  const trigger = useMutation({
    mutationFn: OperationsService.triggerFailureTest,
    onSuccess: () => {
      setShowConfirmation(false);
      setConfirmation("");
      void refresh();
    },
  });
  const recover = useMutation({
    mutationFn: OperationsService.recoverFailureTest,
    onSuccess: () => void refresh(),
  });
  const test = status.data?.failureTest;
  const canTrigger =
    !test ||
    ["completed", "failed"].includes(test.status);
  const canRecover =
    test?.status === "in_dlq" || test?.status === "recovered";

  return (
    <div className="h-full overflow-y-auto bg-surface-container-low">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-bold text-primary">Production / AWS</p>
            <h1 className="text-2xl font-bold sm:text-3xl">运行状态</h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              SNS、SQS、死信队列和受控故障演练的实时视图。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
          >
            <Icon name="refresh" />
            {status.isFetching ? "刷新中…" : "手动刷新"}
          </Button>
        </header>

        {status.error && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>
              {(status.error as Error).message}。其他客服功能不受影响。
            </AlertDescription>
          </Alert>
        )}

        {status.isLoading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : status.data ? (
          <>
            <section className="mt-6 grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>SNS Domain Events</CardTitle>
                  <CardDescription>{status.data.topic.name}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-end justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">已确认订阅</p>
                    <p className="text-3xl font-bold">
                      {status.data.topic.confirmedSubscriptions}
                    </p>
                  </div>
                  <Badge
                    variant={status.data.topic.exists ? "default" : "destructive"}
                  >
                    {status.data.topic.exists ? "可用" : "不可用"}
                  </Badge>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>CloudWatch 告警</CardTitle>
                  <CardDescription>告警只通知，不会自动改变灰度流量。</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {status.data.alarms.map((alarm) => (
                    <Badge
                      key={alarm.name}
                      variant={alarm.state === "ALARM" ? "destructive" : "outline"}
                    >
                      {alarm.name}: {alarm.state}
                    </Badge>
                  ))}
                  {status.data.alarms.length === 0 && (
                    <span className="text-sm text-muted-foreground">暂无告警数据</span>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-2">
              {status.data.queues.map((queue) => (
                <QueueCard key={queue.key} queue={queue} />
              ))}
            </section>

            {session.user.role === "admin" && (
              <Card className="mt-6 border-error/30">
                <CardHeader>
                  <CardTitle>管理员故障演练</CardTitle>
                  <CardDescription>
                    发布专用测试事件，真实验证 SNS → SQS → 第五次失败进入 DLQ →
                    Redrive。不会创建客户订单或客服会话。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 rounded-xl bg-muted p-4">
                    <p className="text-sm text-muted-foreground">当前阶段</p>
                    <p className="mt-1 text-lg font-bold">{testStep(test?.status)}</p>
                    {test && (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        Test ID: {test.testId}
                      </p>
                    )}
                  </div>
                  {(trigger.error || recover.error) && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>
                        {((trigger.error || recover.error) as Error).message}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      variant="destructive"
                      disabled={!canTrigger || trigger.isPending}
                      onClick={() => setShowConfirmation(true)}
                    >
                      触发真实 DLQ 异常
                    </Button>
                    <Button
                      disabled={!canRecover || recover.isPending || !test}
                      onClick={() => test && recover.mutate(test.testId)}
                    >
                      {recover.isPending ? "正在 Redrive…" : "解除异常并 Redrive"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <p className="mt-4 text-right text-xs text-muted-foreground">
              最后刷新：
              {new Date(status.data.refreshedAt).toLocaleString("zh-CN")}
            </p>
          </>
        ) : null}
      </div>

      {showConfirmation && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="failure-test-title"
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle id="failure-test-title">确认触发真实故障演练</CardTitle>
              <CardDescription>
                两个消费者将受控失败，CloudWatch DLQ 告警会进入 ALARM。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label htmlFor="failure-confirmation" className="text-sm font-bold">
                输入 TRIGGER 继续
              </label>
              <Input
                id="failure-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-2"
                autoFocus
              />
              <div className="mt-5 flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowConfirmation(false);
                    setConfirmation("");
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={confirmation !== "TRIGGER" || trigger.isPending}
                  onClick={() => trigger.mutate()}
                >
                  {trigger.isPending ? "正在触发…" : "确认触发"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
