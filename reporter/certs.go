// SPDX-License-Identifier: Apache-2.0

package main

// Slim images (node:*-slim, python:*-slim) have no CA bundle: Node and Python bring their own,
// but this binary uses the system's, so HTTPS to Observator would fail there. The fallback is
// Mozilla's root store, used only when the image has none of its own.
import _ "golang.org/x/crypto/x509roots/fallback"
