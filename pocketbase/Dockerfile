# SPDX-License-Identifier: FSL-1.1-ALv2
# Minimal PocketBase image for Observator. PocketBase has no official image.
FROM alpine:3.24.3

ARG PB_VERSION=0.42.3
# PocketBase left GitHub in v0.41.0. Releases and their checksums.txt are at
# <base>/v<version>/; a new version needs both checksums from that file.
ARG PB_DOWNLOAD_BASE=https://ganigeorgiev.com/meta/pocketbase/pocketbase/download
ARG PB_SHA256_AMD64=89b1ded352404c648dd92c2d884fc8ff7858138697cb1ccb52722ccaa0bbd2a9
ARG PB_SHA256_ARM64=f2af25259c5565e856aac5907a8fd9a7ce01d18375ac70b18121c9d41fd56dbe
ARG TARGETARCH

RUN apk add --no-cache ca-certificates \
    && case "${TARGETARCH:-amd64}" in \
         amd64) sum="$PB_SHA256_AMD64" ;; \
         arm64) sum="$PB_SHA256_ARM64" ;; \
         *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && zip="pocketbase_${PB_VERSION}_linux_${TARGETARCH:-amd64}.zip" \
    && wget -q -O "/tmp/$zip" "$PB_DOWNLOAD_BASE/v$PB_VERSION/$zip" \
    && echo "$sum  /tmp/$zip" | sha256sum -c - \
    && mkdir -p /pb && unzip -q "/tmp/$zip" pocketbase -d /pb \
    && rm "/tmp/$zip" \
    && addgroup -S pb && adduser -S -G pb -h /pb pb \
    && mkdir -p /pb/pb_data && chown pb:pb /pb/pb_data

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY entrypoint.sh /pb/entrypoint.sh
# The running version, for Observator's check of its own PocketBase (pb_hooks/observator.pb.js).
ENV PB_VERSION=$PB_VERSION

USER pb
WORKDIR /pb
VOLUME /pb/pb_data
EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/bin/sh", "/pb/entrypoint.sh"]
