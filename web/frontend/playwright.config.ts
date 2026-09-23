import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(
  new URL("../.cache/playwright", import.meta.url),
);
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8090",
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "cd ../backend && go run ./cmd/fixture",
    url: "http://127.0.0.1:8090/healthz",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
