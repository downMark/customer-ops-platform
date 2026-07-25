#!/usr/bin/env sh
set -eu

model_path="${MODEL_PATH:-/models/customer-ops-q4_k_m.gguf}"
model_s3_uri="${MODEL_S3_URI:-}"
model_sha256="${MODEL_SHA256:-}"

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

exec python3 -m app
