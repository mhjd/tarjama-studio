import { defineConfig } from "../frontend/node_modules/@playwright/test/index.js";
export default defineConfig({
  testDir: ".",
  testMatch: "identity.spec.ts",
  outputDir: "../.cache/keycloak-test/results",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:8091",
    actionTimeout: 15000,
    launchOptions: { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] },
    // Credentials and OIDC codes are deliberately not recorded in traces/videos.
    trace: "off",
  },
  webServer: {
    command: "cd ../backend && go run ./cmd/tarjama api",
    url: "http://localhost:8090/readyz",
    timeout: 60000,
  },
});
