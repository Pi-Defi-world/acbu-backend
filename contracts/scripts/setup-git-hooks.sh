#!/bin/bash
# Setup git hooks for this project

set -e

echo "🔧 Setting up git hooks..."

git config core.hooksPath .githooks

chmod +x .githooks/*

echo "✅ Git hooks configured successfully!"
echo "   core.hooksPath = $(git config core.hooksPath)"
