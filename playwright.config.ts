import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /patrol\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-patrol",
      testMatch: /patrol\.spec\.ts/,
      timeout: 120_000, // real network: Nominatim + downloading the real COCO-SSD model weights
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["geolocation", "camera"],
        geolocation: { latitude: 13.0592, longitude: 80.2503 },
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
        navigationTimeout: 60_000,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
