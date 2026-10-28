// SPDX-License-Identifier: FSL-1.1-ALv2
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // What env() requires; nothing is reached at these addresses.
    env: {
      APP_URL: "http://localhost:3000",
      PB_SUPERUSER_EMAIL: "test@example.com",
      PB_SUPERUSER_PASSWORD: "test-password-not-secret",
    },
  },
});
