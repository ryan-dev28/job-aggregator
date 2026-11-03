#!/bin/sh
set -e

# Start Xvfb
Xvfb :99 -ac -screen 0 $XVFB_WHD -nolisten tcp &
export DISPLAY=:99

# Wait for Xvfb
MAX_ATTEMPTS=10
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  xdpyinfo -display $DISPLAY >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT+1))
  sleep 1
done

# Run the command
exec "$@"