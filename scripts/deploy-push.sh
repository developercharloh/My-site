#!/bin/bash
# Runs as the deployment's postBuild step. Two jobs:
#   1. Prune pnpm store (keeps deploy image small).
#   2. Push the exact deployed snapshot to GitHub origin and tag it
#      `deploy-<UTC timestamp>` so every published build is reproducible
#      from the repo. Soft-fails on any error so a transient git/network
#      problem can never block a deployment.

set +e

echo "[deploy-push] pruning pnpm store..."
pnpm store prune || echo "[deploy-push] pnpm store prune failed (non-fatal)"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "[deploy-push] skip: GITHUB_TOKEN not set"
    exit 0
fi

if [ ! -d .git ]; then
    echo "[deploy-push] skip: no .git in deployment build container"
    exit 0
fi

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ -z "$BRANCH" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
fi
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
    BRANCH=main
fi

TS=$(date -u +%Y%m%d-%H%M%S)
TAG="deploy-${TS}"

# Ensure git has an identity inside the deploy container
git config user.email "deploy-bot@replit.app" 2>/dev/null
git config user.name  "Replit Deploy Bot"     2>/dev/null

echo "[deploy-push] tagging $TAG and pushing branch $BRANCH..."
git tag -a "$TAG" -m "Replit deployment $TS" 2>/dev/null

CRED='credential.helper=!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f'
git -c "$CRED" push origin "$BRANCH" 2>&1 | sed 's/^/[deploy-push] /'
git -c "$CRED" push origin "$TAG"    2>&1 | sed 's/^/[deploy-push] /'

echo "[deploy-push] done"
exit 0
