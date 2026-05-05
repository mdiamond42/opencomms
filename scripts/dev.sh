#!/bin/sh
set -eu

pnpm --parallel --filter @agentcomms/bridge --filter @agentcomms/client dev
