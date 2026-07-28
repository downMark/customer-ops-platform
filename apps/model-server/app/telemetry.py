from __future__ import annotations

import os
import resource
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import TracebackType
from typing import Any

try:
    from customer_ops_performance import (
        PerformanceClient,
        TraceContext,
        parse_traceparent,
    )
except ModuleNotFoundError:
    sys.path.insert(
        0,
        str(Path(__file__).parents[2] / "performance/sdk/python/src"),
    )
    from customer_ops_performance import (  # type: ignore[no-redef]
        PerformanceClient,
        TraceContext,
        parse_traceparent,
    )


performance = PerformanceClient(
    service="model-server",
    environment=os.getenv("APP_ENVIRONMENT", "local"),
    release=os.getenv("APP_RELEASE", "development"),
    sample_rate=float(os.getenv("PERFORMANCE_SAMPLE_RATE", "0.1")),
    slow_threshold_ms=float(os.getenv("PERFORMANCE_SLOW_THRESHOLD_MS", "2000")),
)


def parent_context(traceparent: str | None) -> TraceContext | None:
    return parse_traceparent(traceparent)


class TimedInferenceLock:
    """Drop-in Lock that records contention without blocking the logging path."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._waiting = 0

    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:
        started_at = time.perf_counter()
        with self._state_lock:
            self._waiting += 1
            waiting = self._waiting
        try:
            acquired = (
                self._lock.acquire(blocking)
                if timeout == -1
                else self._lock.acquire(blocking, timeout)
            )
        finally:
            with self._state_lock:
                self._waiting -= 1
        if acquired:
            performance.record_metric(
                "model.lock",
                {
                    "queueMs": (time.perf_counter() - started_at) * 1000,
                    "count": float(waiting),
                },
            )
        return acquired

    def release(self) -> None:
        self._lock.release()

    def locked(self) -> bool:
        return self._lock.locked()

    def __enter__(self) -> TimedInferenceLock:
        self.acquire()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


class GpuSampler:
    def __init__(self, interval_seconds: float = 10.0) -> None:
        self._interval = max(1.0, interval_seconds)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="gpu-performance-sampler", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def _run(self) -> None:
        handle: Any = None
        pynvml: Any = None
        try:
            import pynvml as imported_pynvml

            pynvml = imported_pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception:
            handle = None
        try:
            while not self._stop.wait(self._interval):
                measurements: dict[str, float] = {
                    "rssBytes": float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024),
                }
                attributes: dict[str, str] = {"runtime": "python"}
                if handle is not None and pynvml is not None:
                    try:
                        utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                        memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
                        measurements.update(
                            gpuUtilizationPercent=float(utilization.gpu),
                            gpuMemoryUsedBytes=float(memory.used),
                            gpuMemoryTotalBytes=float(memory.total),
                            gpuTemperatureCelsius=float(
                                pynvml.nvmlDeviceGetTemperature(
                                    handle, pynvml.NVML_TEMPERATURE_GPU
                                )
                            ),
                            gpuPowerWatts=float(
                                pynvml.nvmlDeviceGetPowerUsage(handle) / 1000
                            ),
                        )
                        name = pynvml.nvmlDeviceGetName(handle)
                        attributes["gpuName"] = (
                            name.decode() if isinstance(name, bytes) else str(name)
                        )[:96]
                    except Exception:
                        pass
                elif handle is None:
                    try:
                        output = subprocess.run(
                            [
                                "nvidia-smi",
                                "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,name",
                                "--format=csv,noheader,nounits",
                            ],
                            check=True,
                            capture_output=True,
                            text=True,
                            timeout=2,
                        ).stdout.splitlines()[0]
                        utilization, used, total, temperature, power, name = (
                            part.strip() for part in output.split(",", 5)
                        )
                        measurements.update(
                            gpuUtilizationPercent=float(utilization),
                            gpuMemoryUsedBytes=float(used) * 1024 * 1024,
                            gpuMemoryTotalBytes=float(total) * 1024 * 1024,
                            gpuTemperatureCelsius=float(temperature),
                            gpuPowerWatts=float(power),
                        )
                        attributes["gpuName"] = name[:96]
                    except Exception:
                        pass
                performance.record_metric("runtime.gpu", measurements, attributes)
        finally:
            if pynvml is not None:
                try:
                    pynvml.nvmlShutdown()
                except Exception:
                    pass
