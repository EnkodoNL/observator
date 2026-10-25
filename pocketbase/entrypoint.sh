#!/bin/sh
# SPDX-License-Identifier: FSL-1.1-ALv2
set -eu

: "${PB_SUPERUSER_EMAIL:?PB_SUPERUSER_EMAIL is required}"
: "${PB_SUPERUSER_PASSWORD:?PB_SUPERUSER_PASSWORD is required}"

PB="/pb/pocketbase"
ARGS="--dir=/pb/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"

# Apply migrations first so the superuser upsert runs against an up-to-date schema.
# shellcheck disable=SC2086
"$PB" migrate up $ARGS
# shellcheck disable=SC2086
"$PB" superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" $ARGS

# shellcheck disable=SC2086
exec "$PB" serve --http=0.0.0.0:8090 $ARGS
