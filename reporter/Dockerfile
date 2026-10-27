# SPDX-License-Identifier: Apache-2.0
# The reporter image: one static binary and nothing else. Cross-compiled with the build host's
# own Go for every target platform, so no emulation is needed.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine AS build
ARG TARGETOS TARGETARCH TARGETVARIANT
ARG VERSION=dev
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /reporter .

FROM scratch
COPY --from=build /reporter /reporter
ENTRYPOINT ["/reporter"]
