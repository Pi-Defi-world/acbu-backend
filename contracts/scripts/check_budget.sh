#!/usr/bin/env bash

set -euo pipefail

MAX_SIZE_BYTES=60000
WASM_DIR="target/wasm32-unknown-unknown/release"

if [[ ! -d "$WASM_DIR" ]]; then
	echo "Error: WASM directory not found: $WASM_DIR" >&2
	exit 1
fi

shopt -s nullglob
wasm_files=("$WASM_DIR"/*.wasm)

if (( ${#wasm_files[@]} == 0 )); then
	echo "Error: no .wasm files found in $WASM_DIR" >&2
	exit 1
fi

has_violation=0

for wasm_file in "${wasm_files[@]}"; do
	size_bytes=$(stat -c '%s' "$wasm_file")
	contract_name=$(basename "$wasm_file")

	echo "$contract_name: $size_bytes bytes"

	if (( size_bytes > MAX_SIZE_BYTES )); then
		echo "Error: $contract_name exceeds the maximum size of $MAX_SIZE_BYTES bytes" >&2
		has_violation=1
	fi
done

if (( has_violation )); then
	exit 1
fi

echo "Success: all WASM contracts are within the $MAX_SIZE_BYTES byte limit."
