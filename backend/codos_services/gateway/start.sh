#!/bin/bash
set -e
# Start the gateway-ui backend server
cd "$(dirname "$0")" || exit 1
poetry run python server.py
