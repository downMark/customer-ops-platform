FROM python:3.12-slim-bookworm AS cpu-builder

ENV DEBIAN_FRONTEND=noninteractive \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    CMAKE_ARGS="-DGGML_CUDA=off -DGGML_NATIVE=off" \
    FORCE_CMAKE=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        git \
        ninja-build \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /workspace/model-server

COPY apps/model-server/pyproject.toml apps/model-server/uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS cpu-runtime-base

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app/performance-sdk \
    MODEL_HOST=0.0.0.0 \
    MODEL_PORT=8000 \
    MODEL_PATH=/models/customer-ops-q4_k_m.gguf \
    EMBEDDING_MODEL_PATH=/models/bge-m3-onnx/model.onnx \
    RERANK_MODEL_PATH=/models/bge-reranker-v2-m3-onnx/model.onnx

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        libgomp1 \
        unzip \
    && case "${TARGETARCH:-amd64}" in \
        amd64) aws_arch=x86_64 ;; \
        arm64) aws_arch=aarch64 ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && curl --fail --show-error --silent \
        "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" \
        --output /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip /var/lib/apt/lists/*

WORKDIR /app

COPY apps/model-server/app ./app
COPY apps/performance/sdk/python/src /app/performance-sdk
COPY apps/model-server/scripts/start-container.sh /usr/local/bin/start-model-server

RUN chmod 0555 /usr/local/bin/start-model-server \
    && mkdir -p /models

EXPOSE 8000

ENTRYPOINT ["start-model-server"]

FROM nvidia/cuda:12.6.3-devel-ubuntu24.04 AS gpu-builder

ENV DEBIAN_FRONTEND=noninteractive \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON=/usr/bin/python3 \
    CMAKE_ARGS="-DGGML_CUDA=on -DGGML_NATIVE=off -DCMAKE_CUDA_ARCHITECTURES=75" \
    FORCE_CMAKE=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        git \
        ninja-build \
        python3 \
        python3-dev \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /workspace/model-server

COPY apps/model-server/pyproject.toml apps/model-server/uv.lock ./
RUN uv sync --frozen --no-dev

FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04 AS gpu-runtime-base

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app/performance-sdk \
    MODEL_HOST=0.0.0.0 \
    MODEL_PORT=8000 \
    MODEL_PATH=/models/customer-ops-q4_k_m.gguf \
    EMBEDDING_MODEL_PATH=/models/bge-m3-onnx/model.onnx \
    RERANK_MODEL_PATH=/models/bge-reranker-v2-m3-onnx/model.onnx

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        libgomp1 \
        python3 \
        unzip \
    && case "${TARGETARCH:-amd64}" in \
        amd64) aws_arch=x86_64 ;; \
        arm64) aws_arch=aarch64 ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && curl --fail --show-error --silent \
        "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" \
        --output /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip /var/lib/apt/lists/*

WORKDIR /app

COPY apps/model-server/app ./app
COPY apps/performance/sdk/python/src /app/performance-sdk
COPY apps/model-server/scripts/start-container.sh /usr/local/bin/start-model-server

RUN chmod 0555 /usr/local/bin/start-model-server \
    && mkdir -p /models

EXPOSE 8000

ENTRYPOINT ["start-model-server"]

FROM cpu-runtime-base AS cpu-runtime

COPY --from=cpu-builder /opt/venv /opt/venv

ENV MODEL_GPU_LAYERS=0

FROM gpu-runtime-base AS gpu-runtime

COPY --from=gpu-builder /opt/venv /opt/venv

ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    NVIDIA_VISIBLE_DEVICES=all \
    MODEL_GPU_LAYERS=-1

FROM gpu-runtime AS runtime
