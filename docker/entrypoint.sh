#!/bin/bash
set -euo pipefail
# Client-only deployments must not start legacy Draw.io/Xvfb converters.
# Exec as PID 1 so Docker stop signals reach the API directly.
exec python backend/main.py
