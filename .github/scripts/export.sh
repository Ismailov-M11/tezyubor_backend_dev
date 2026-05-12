#!/usr/bin/env bash

fetch() {
  local path="$1"
  local target="$2"

  : > "$target"

  if [[ "${DEBUG:-false}" == "true" ]]; then
    echo "[DEBUG] Vault path: $path"
    echo "[DEBUG] Vault addr: $VAULT_ADDR"
  fi

  response=$(curl \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    "${VAULT_ADDR}/v1/kv/data/${path}") || {
      echo "[ERROR] Vault request failed"
      exit 1
  }

  if [[ "${DEBUG:-false}" == "true" ]]; then
    echo "[DEBUG] Raw response:"
    echo "$response" | jq .
  fi

  echo "$response" | jq -e -r '
    .data.data
    | to_entries[]
    | "\(.key)=\(.value)"
  ' >> "$target"
}