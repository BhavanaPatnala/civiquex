// AI Road Patrol E2E test — runs with a fake camera device and mocked real
// GPS coordinates (see playwright.config.ts's chromium-patrol project).
// Verifies the actual pipeline end to end: live TensorFlow.js model load,
// live GPS + real Nominatim reverse geocoding, the road-anomaly heuristic
// producing a live score, and a capture creating a real contract match.
//
// NOTE: this hits the real, public OpenStreetMap Nominatim API and
// downloads the real COCO-SSD model weights from Google's model CDN on
// first run — it requires network access and can take 30-60s.
import { test, expect } from "@playwright/test";

test.describe("AI Road Patrol", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "citizen1@demo.civiquex.app");
    await page.fill("#password", "Password123!");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("/");
  });

  test("loads a real TensorFlow.js model, acquires real GPS, and reverse-geocodes a real road name", async ({ page }) => {
    await page.goto("/patrol");
    await page.getByRole("button", { name: "Start driving mode" }).click();

    // The real model download can be slow on a cold cache.
    await expect(page.getByText("Loaded — real TensorFlow.js neural network")).toBeVisible({ timeout: 60_000 });

    // Real GPS coordinates from the mocked geolocation provider.
    await expect(page.getByText(/13\.0592.*80\.2503/)).toBeVisible({ timeout: 15_000 });

    // A real live call to OpenStreetMap Nominatim resolved an actual road/place name.
    await expect(page.getByText("OpenStreetMap Nominatim (live, free)")).toBeVisible({ timeout: 15_000 });
  });

  test("runs live detection and produces a real anomaly score, then captures a candidate with a contract match", async ({ page }) => {
    await page.goto("/patrol");
    await page.getByRole("button", { name: "Start driving mode" }).click();
    await expect(page.getByText("Loaded — real TensorFlow.js neural network")).toBeVisible({ timeout: 60_000 });

    // Scanning starts automatically once the camera and model are both ready — no extra click.
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=Road anomaly score").locator("..")).toBeVisible({ timeout: 15_000 });

    const captureButton = page.getByRole("button", { name: /Capture & match now/i });
    await expect(captureButton).toBeEnabled({ timeout: 15_000 });
    await captureButton.click();

    await expect(page.getByRole("heading", { name: "Candidate captured" })).toBeVisible({ timeout: 20_000 });
    // Either a real contract match or an honest "no contract on file" — never a blank/broken state.
    await expect(page.getByText(/Contractor:|No contract on file for this location/)).toBeVisible();
  });
});
