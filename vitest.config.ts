import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Temporary SQLite/drizzle setup can exceed 30s on hosted Windows disks.
    // This changes hook timeouts only; test-operation deadlines stay intact.
    hookTimeout: process.platform === "win32" ? 90_000 : 10_000,
    globals: true,
    passWithNoTests: false,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["client/src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "client/src/main.tsx",
        "client/src/App.tsx",
        "client/src/index.css",
        "client/src/components/ui/**",
        "server/types/**",
        "server/python/**",
        "server/replit_integrations/**",
        "server/static.ts",
        "server/vite.ts",
        "shared/types/**",
      ],
    },
  },
});
