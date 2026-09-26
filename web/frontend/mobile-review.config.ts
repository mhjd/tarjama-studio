import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testDir: "./review",
  testMatch: "mobile-player.spec.ts",
  timeout: 120000,
  outputDir: "../.cache/mobile-player-review/runner",
});
