// SPDX-License-Identifier: FSL-1.1-ALv2
import { dockerSnippet, type SnippetVariant } from "./snippet.ts";

/** The Dockerfiles in examples/express-app, generated so they never drift from the UI. */
export const EXAMPLE_DOCKERFILES: { file: string; variant: SnippetVariant; image: string; note: string }[] = [
  { file: "Dockerfile", variant: "alpine", image: "node:22-alpine", note: "Alpine: BusyBox wget." },
  {
    file: "Dockerfile.slim",
    variant: "node",
    image: "node:22-slim",
    note: "Debian slim: no wget or curl, posts with Node's fetch.",
  },
  { file: "Dockerfile.curl", variant: "curl", image: "node:22", note: "Full Debian image with curl." },
];

export function exampleDockerfile(variant: SnippetVariant, image: string, note: string): string {
  return `# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. ${note}
ARG NODE_IMAGE=${image}

FROM \${NODE_IMAGE} AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]

${dockerSnippet(variant, "https://observator.example.com")}
`;
}
