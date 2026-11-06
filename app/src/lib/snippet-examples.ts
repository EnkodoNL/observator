// SPDX-License-Identifier: FSL-1.1-ALv2
import { dockerSnippet, type SnippetForm } from "./snippet.ts";

export interface ExampleDockerfile {
  /** Path below examples/. */
  path: string;
  content: () => string;
}

const URL = "https://observator.example.com";
const snippet = (form: SnippetForm) => dockerSnippet(URL, { form });

const expressApp = (file: string, image: string, form: SnippetForm, note: string): ExampleDockerfile => ({
  path: `express-app/${file}`,
  content: () => `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. ${note}
ARG NODE_IMAGE=${image}

FROM \${NODE_IMAGE} AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]

${snippet(form)}
`,
});

const pythonApp = (file: string, form: SnippetForm, note: string): ExampleDockerfile => ({
  path: `python-app/${file}`,
  content: () => `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. ${note}
# There is no package.json, so only the runtime version is reported.
ARG PYTHON_IMAGE=python:3.12-slim

FROM \${PYTHON_IMAGE} AS app
WORKDIR /app
COPY main.py ./
CMD ["python3", "main.py"]

${snippet(form)}
`,
});

// Go 1.26 on purpose: one line below the reporter's own Go, so the e2e test proves it read the
// app and not itself.
const goApp = (file: string, final: string, note: string): ExampleDockerfile => ({
  path: `go-app/${file}`,
  content: () => `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. ${note}
# There is no package.json: the reporter reads Go and the modules from the binary itself.
ARG GO_IMAGE=golang:1.26-alpine

FROM \${GO_IMAGE} AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /server .

FROM ${final} AS app
COPY --from=build /server /server
ENTRYPOINT ["/server"]

${snippet("image")}
`,
});

/**
 * The Dockerfiles in examples/, generated so they never drift from the UI. The reporter image
 * (Dockerfile.reporter, .distroless) runs anywhere; the plain sh snippet is the same in each of
 * the others, whose images differ in which client it finds (curl, wget, node or python3).
 */
export const EXAMPLE_DOCKERFILES: ExampleDockerfile[] = [
  expressApp("Dockerfile", "node:22-alpine", "shell", "Plain sh on Alpine: sent with BusyBox wget."),
  expressApp(
    "Dockerfile.slim",
    "node:22-slim",
    "shell",
    "Plain sh on Debian slim: no wget or curl, so sent with Node's fetch.",
  ),
  expressApp("Dockerfile.curl", "node:22", "shell", "Plain sh on full Debian: sent with curl."),
  expressApp("Dockerfile.reporter", "node:26-alpine", "image", "The reporter image."),
  {
    path: "express-app/Dockerfile.distroless",
    content: () => `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. The reporter image on distroless: no shell,
# and node lives in /nodejs/bin, off PATH.
ARG NODE_IMAGE=node:26-slim
ARG DISTROLESS_IMAGE=gcr.io/distroless/nodejs26-debian13

FROM \${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./

FROM \${DISTROLESS_IMAGE} AS app
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["index.js"]

${snippet("image")}
`,
  },
  pythonApp("Dockerfile", "shell", "Plain sh: no curl, wget or Node, so sent with python3."),
  pythonApp("Dockerfile.reporter", "image", "The reporter image."),
  goApp("Dockerfile", "scratch", "The reporter image on scratch: nothing but the program."),
  goApp(
    "Dockerfile.distroless",
    "gcr.io/distroless/static-debian13",
    "The reporter image on distroless static.",
  ),
];
