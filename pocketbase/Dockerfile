# SPDX-License-Identifier: FSL-1.1-ALv2
# Minimal PocketBase image for Observator. PocketBase has no official image.
FROM alpine:3.24.3

ARG PB_VERSION=0.40.6
# 0.40.6 is likely the last release published on GitHub; override this when the download location moves.
ARG PB_DOWNLOAD_BASE=https://github.com/pocketbase/pocketbase/releases/download
ARG PB_SHA256_AMD64=0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f
ARG PB_SHA256_ARM64=d22c66ceb67ca92b7d767f36d826e848a276bcfa3c197ead20bf87c42208984f
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

USER pb
WORKDIR /pb
VOLUME /pb/pb_data
EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/bin/sh", "/pb/entrypoint.sh"]
