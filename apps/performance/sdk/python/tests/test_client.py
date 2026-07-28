import time

from customer_ops_performance import PerformanceClient, TraceContext, format_traceparent, parse_traceparent


def test_traceparent_round_trip() -> None:
    context = TraceContext("a" * 32, "b" * 16, True)
    assert parse_traceparent(format_traceparent(context)) == context


def test_errors_and_metrics_bypass_sampling() -> None:
    events = []
    client = PerformanceClient("model-server", sample_rate=0, slow_threshold_ms=60_000, sink=events.append)
    client.start_span("model.normal").finish()
    client.start_span("model.failed").finish("error")
    client.record_metric("runtime.gpu", {"gpuUtilizationPercent": 50})
    client.close()
    assert [event["eventType"] for event in events] == ["span", "metric"]


def test_sensitive_fields_and_url_queries_are_removed() -> None:
    events = []
    client = PerformanceClient("model-server", sink=events.append)
    client.record_metric(
        "model.request",
        {"ttftMs": 12, "userId": 123},
        {"endpoint": "/v1/chat?token=secret", "orderId": "secret"},
    )
    client.close()
    assert events[0]["measurements"] == {"ttftMs": 12}
    assert events[0]["attributes"] == {"endpoint": "/v1/chat"}


def test_start_finish_p95_overhead_is_below_one_millisecond() -> None:
    client = PerformanceClient(
        "model-server",
        sample_rate=0.1,
        max_queue_size=1,
        sink=lambda _event: None,
    )
    durations = []
    for _ in range(5_000):
        started = time.perf_counter()
        client.start_span("benchmark.request").finish()
        durations.append((time.perf_counter() - started) * 1_000)
    client.close()
    durations.sort()
    assert durations[int(len(durations) * 0.95)] < 1
