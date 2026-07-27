#!/usr/bin/env sh
set -eu

model_path="${MODEL_PATH:-/models/customer-ops-q4_k_m.gguf}"
model_s3_uri="${MODEL_S3_URI:-}"
model_sha256="${MODEL_SHA256:-}"
embedding_model_path="${EMBEDDING_MODEL_PATH:-/models/bge-m3-onnx/model.onnx}"
embedding_model_s3_uri="${EMBEDDING_MODEL_S3_URI:-}"
rerank_model_path="${RERANK_MODEL_PATH:-/models/bge-reranker-v2-m3-onnx/model.onnx}"
rerank_model_s3_uri="${RERANK_MODEL_S3_URI:-}"

if [ ! -s "${model_path}" ]; then
  if [ -z "${model_s3_uri}" ]; then
    echo "MODEL_S3_URI is required when ${model_path} is not present" >&2
    exit 1
  fi

  mkdir -p "$(dirname "${model_path}")"
  temporary_path="${model_path}.part"
  rm -f "${temporary_path}"

  echo "Downloading model artifact from ${model_s3_uri}"
  aws s3 cp "${model_s3_uri}" "${temporary_path}" --only-show-errors

  if [ -n "${model_sha256}" ]; then
    actual_sha256="$(sha256sum "${temporary_path}" | awk '{print $1}')"
    if [ "${actual_sha256}" != "${model_sha256}" ]; then
      echo "GGUF SHA-256 mismatch" >&2
      rm -f "${temporary_path}"
      exit 1
    fi
  fi

  mv "${temporary_path}" "${model_path}"
fi

download_onnx_directory() {
  model_name="$1"
  onnx_path="$2"
  s3_uri="$3"
  target_directory="$(dirname "${onnx_path}")"

  if [ -s "${onnx_path}" ] \
    && [ -s "${target_directory}/model.onnx_data" ] \
    && [ -s "${target_directory}/tokenizer.json" ]; then
    return
  fi
  if [ -z "${s3_uri}" ]; then
    echo "${model_name} S3 URI is required when ${onnx_path} is absent" >&2
    exit 1
  fi
  case "${target_directory}" in
    /models/*) ;;
    *)
      echo "Refusing to replace ONNX directory outside /models: ${target_directory}" >&2
      exit 1
      ;;
  esac

  temporary_directory="${target_directory}.part"
  rm -rf "${temporary_directory}"
  mkdir -p "${temporary_directory}"
  echo "Downloading ${model_name} artifacts from ${s3_uri}"
  aws s3 cp "${s3_uri}" "${temporary_directory}/" \
    --recursive \
    --exclude "._*" \
    --only-show-errors

  if [ ! -s "${temporary_directory}/SHA256SUMS" ]; then
    echo "${model_name} SHA256SUMS is missing" >&2
    rm -rf "${temporary_directory}"
    exit 1
  fi
  (
    cd "${temporary_directory}"
    sha256sum -c SHA256SUMS
  )
  rm -rf "${target_directory}"
  mv "${temporary_directory}" "${target_directory}"
}

download_onnx_directory "embedding model" "${embedding_model_path}" "${embedding_model_s3_uri}"
download_onnx_directory "rerank model" "${rerank_model_path}" "${rerank_model_s3_uri}"

exec python3 -m app
