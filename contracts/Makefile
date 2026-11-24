.DEFAULT_GOAL := help

SHELL := /bin/bash
MAKEFLAGS += --silent

.PHONY: help build build-minting test test-minting deploy-testnet deploy-mainnet \
        update-registry setup-hooks validate-snapshots clean-snapshots \
        docs-error-codes check-error-codes

help:
	@printf "Usage:\n"
	@printf "  make build              Build all contracts\n"
	@printf "  make test               Run all workspace tests\n"
	@printf "  make deploy-testnet     Deploy all 8 contracts to Stellar testnet\n"
	@printf "  make deploy-mainnet     Deploy all 8 contracts to Stellar mainnet\n"
	@printf "                            (requires DEPLOY_CONFIRM=deploy)\n"
	@printf "  make update-registry    Rebuild deployments/registry.json from per-network snapshots\n"
	@printf "  make setup-hooks        Install git hooks for the repository\n"
	@printf "  make build-minting      Build the acbu_minting contract\n"
	@printf "  make test-minting       Run tests for the acbu_minting contract\n"
	@printf "  make validate-snapshots Validate test snapshots for staleness\n"
	@printf "  make clean-snapshots    Delete all test snapshots (use before regeneration)\n"
	@printf "  make docs-error-codes   Regenerate docs/ERROR_CODES.md from source\n"
	@printf "  make check-error-codes  Verify docs/ERROR_CODES.md matches source\n"

build:
	@printf "Building all contracts...\n"
	cargo build --target wasm32-unknown-unknown --release

build-minting:
	@printf "Building acbu_minting contract...\n"
	cd acbu_minting && cargo build --target wasm32-unknown-unknown --release

test:
	@printf "Running workspace tests...\n"
	cargo test

test-minting:
	@printf "Running acbu_minting tests...\n"
	cd acbu_minting && cargo test

deploy-testnet:
	@if [ -z "$$STELLAR_SECRET_KEY" ]; then \
		echo "ERROR: STELLAR_SECRET_KEY must be set for deployment."; \
		echo "  export STELLAR_SECRET_KEY=\"<your-testnet-secret-key>\""; \
		exit 1; \
	fi
	@printf "Deploying all 8 contracts to testnet...\n"
	bash scripts/deploy.sh testnet

deploy-mainnet:
	@if [ -z "$$STELLAR_SECRET_KEY" ]; then \
		echo "ERROR: STELLAR_SECRET_KEY must be set for deployment."; \
		echo "  export STELLAR_SECRET_KEY=\"<your-mainnet-secret-key>\""; \
		exit 1; \
	fi
	@if [ "$$DEPLOY_CONFIRM" != "deploy" ]; then \
		echo "ERROR: Mainnet deploy requires DEPLOY_CONFIRM=deploy."; \
		echo "  export DEPLOY_CONFIRM=deploy"; \
		exit 1; \
	fi
	@printf "Deploying all 8 contracts to mainnet...\n"
	bash scripts/deploy.sh mainnet

update-registry:
	@printf "Rebuilding deployments/registry.json from per-network snapshots...\n"
	@for net in testnet mainnet; do \
		file="deployments/$${net}.json"; \
		if [ -f "$$file" ]; then \
			bash scripts/update_registry.sh "$$net" "$$file"; \
		fi; \
	done
	@printf "Registry updated.\n"

setup-hooks:
	@printf "Setting up git hooks...\n"
	bash scripts/setup-git-hooks.sh

validate-snapshots:
	@printf "Validating test snapshots...\n"
	cargo test test_snapshot_validation --package acbu_minting -- --nocapture

clean-snapshots:
	@printf "Cleaning test snapshots...\n"
	rm -rf acbu_minting/test_snapshots/*.json
	@printf "Snapshots cleaned. Regenerate by running: make test-minting\n"

docs-error-codes:
	@printf "Regenerating docs/ERROR_CODES.md...\n"
	python scripts/generate_error_codes.py

check-error-codes:
	@printf "Checking docs/ERROR_CODES.md against source...\n"
	python scripts/generate_error_codes.py --check
