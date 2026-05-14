#!/bin/bash
set -e

# Clean stale npm temp directories left over from interrupted installs.
# These are dot-prefixed dirs in node_modules (e.g. .cli-highlight-XXXX) and
# cause `ENOTEMPTY: directory not empty` errors on the next `npm install`.
if [ -d node_modules ]; then
    find node_modules -maxdepth 1 -type d -name ".*-*" -exec rm -rf {} + 2>/dev/null || true
fi

HUSKY=0 npm install --legacy-peer-deps
