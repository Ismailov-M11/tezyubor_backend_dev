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
    ' > /tmp/vault_kv.txt

  while IFS=$'\t' read -r key value; do
    mask_value "$value"
    if [ "$target" = "env" ]; then
      export_to_env "$key" "$value"
    else
      printf '%s=%s\n' "$key" "$value" >> "$target"
    fi
  done < /tmp/vault_kv.txt

  rm -f /tmp/vault_kv.txt
}