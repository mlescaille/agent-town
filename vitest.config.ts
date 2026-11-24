import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
    ],
    testTimeout: 20000,
    server: {
      deps: {
        external: ["@cedar-policy/cedar-wasm"],
      },
    },
  },
});
