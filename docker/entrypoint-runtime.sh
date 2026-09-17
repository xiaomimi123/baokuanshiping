#!/bin/bash
set -euo pipefail
mkdir -p /projects/default
cd /projects/default
if [ ! -f hypit.runtime.json ]; then cp /opt/runtime.docker.json hypit.runtime.json; fi
node /opt/hypit/bin/hypit.mjs runtime use hypit.runtime.json
node /opt/hypit/bin/hypit.mjs runtime up
echo "Runtime worker ready; tailing"
exec tail -f /dev/null
