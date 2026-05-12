#!/usr/bin/env bash

fetch() {
  local path="$1"
  local target="$2"

  curl -sf \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    "${VAULT_ADDR}/v1/kv/data/${path}" \
  | jq -r '
      .data.data
      | to_entries[]
      | "\(.key)\t\(.value)"
    ' \
  | while IFS=$'\t' read -r key value; do
      printf '%s=%s\n' "$key" "$value" >> "$target"
    done
}
