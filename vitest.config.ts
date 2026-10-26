import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const sources = "{apps,packages}/*/src/**";
const integrationTests = `${sources}/*.int.test.ts`;

const resolve = {
  alias: [
    // apps/web's `@/*` path alias (see apps/web/tsconfig.json).
    { find: /^@\//, replacement: fromRoot("./apps/web/src/") },
    // `server-only` throws outside a React Server Components bundle; tests import server modules directly.
    { find: /^server-only$/, replacement: fromRoot("./test/server-only-stub.ts") },
  ],
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          include: [`${sources}/*.test.{ts,tsx}`],
          exclude: ["**/node_modules/**", integrationTests],
          setupFiles: [fromRoot("./test/setup.unit.ts")],
          unstubGlobals: true,
          unstubEnvs: true,
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          include: [integrationTests],
          setupFiles: [fromRoot("./test/setup.integration.ts")],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
