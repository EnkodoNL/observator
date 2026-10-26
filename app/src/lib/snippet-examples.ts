// SPDX-License-Identifier: FSL-1.1-ALv2
import { dockerSnippet } from "./snippet.ts";

export interface ExampleDockerfile {
  /** Path below examples/. */
  path: string;
  content: () => string;
}

const SNIPPET = () => dockerSnippet("https://observator.example.com");

const expressApp = (file: string, image: string, note: string): ExampleDockerfile => ({
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

${SNIPPET()}
`,
});

/**
 * The Dockerfiles in examples/, generated so they never drift from the UI. The snippet is the
 * same in each; the images differ in which client it finds (curl, wget, node or python3).
 */
export const EXAMPLE_DOCKERFILES: ExampleDockerfile[] = [
  expressApp("Dockerfile", "node:22-alpine", "Alpine: sent with BusyBox wget."),
  expressApp("Dockerfile.slim", "node:22-slim", "Debian slim: no wget or curl, so sent with Node's fetch."),
  expressApp("Dockerfile.curl", "node:22", "Full Debian image: sent with curl."),
  {
    path: "python-app/Dockerfile",
    content: () => `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. Python, no curl, wget or Node: sent with
# python3. There is no package.json, so only the runtime version is reported.
ARG PYTHON_IMAGE=python:3.12-slim

FROM \${PYTHON_IMAGE} AS app
WORKDIR /app
COPY main.py ./
CMD ["python3", "main.py"]

${SNIPPET()}
`,
  },
];
