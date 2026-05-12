#!/usr/bin/env bash

fetch() {
  curl -sf \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    "${{ secrets.VAULT_ADDR }}/v1/kv/data/$1" \
  | jq -r '
      .data.data
      | to_entries[]
      | if (.value | type == "string" and contains("\n"))
        then "\(.key)<<EOF\n\(.value)\nEOF"
        else "\(.key)=\(.value)"
      end
    '
}