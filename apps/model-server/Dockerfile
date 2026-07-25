FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    CMAKE_ARGS=-DGGML_CUDA=on \
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
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04 AS runtime

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/venv/bin:$PATH \
    MODEL_HOST=0.0.0.0 \
    MODEL_PORT=8000 \
    MODEL_PATH=/models/customer-ops-q4_k_m.gguf

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

COPY --from=builder /opt/venv /opt/venv
COPY app ./app
COPY scripts/start-container.sh /usr/local/bin/start-model-server

RUN chmod 0555 /usr/local/bin/start-model-server \
    && mkdir -p /models

EXPOSE 8000

ENTRYPOINT ["start-model-server"]
