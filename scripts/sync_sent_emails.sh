#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
node scripts/export_sent_emails.mjs "$@"
