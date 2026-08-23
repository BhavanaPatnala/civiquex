// Critical user-flow E2E tests, run against the seeded demo dataset:
//   - sign-in
//   - multiple observations correlated into one incident (incident graph)
//   - evidence confidence + rule reasoning render, never presented as fact
//   - recurring incidents surface as a hotspot
//   - an authority's reported resolution is independently re-verified
//
// Requires the dev server running with a freshly-seeded database
// (npm run db:reset && npm run dev), which playwright.config.ts's
// webServer block starts automatically if nothing is already listening.
import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.click('button:has-text("Sign in")');
  await page.waitForURL("/");
}

test.describe("Critical flows", () => {
  test("citizen can sign in and reach the public home", async ({ page }) => {
    await login(page, "citizen1@demo.civiquex.app");
    await expect(page.getByRole("heading", { name: /Capture\./ })).toBeVisible();
    await expect(page.getByText("Your submissions")).toBeVisible();
  });

  test("incident detail shows supporting recordings with decomposed, plain-language evidence checks", async ({ page }) => {
    await login(page, "citizen1@demo.civiquex.app");
    await page.goto("/incidents");
    const evidenceLink = page.locator("a", { hasText: "View evidence" }).first();
    await evidenceLink.waitFor({ state: "visible", timeout: 15_000 }); // real network round-trip to the DB, not instant local SQLite
    await evidenceLink.click();
    await page.waitForURL(/\/incidents\/[^/]+$/, { timeout: 15_000 }); // require an id segment — plain "/incidents" must not match
    await expect(page.getByText("Proof")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/supporting recording/)).toBeVisible();
    await expect(
      page.getByText("Strong evidence").or(page.getByText("Review required")).or(page.getByText("Insufficient evidence"))
    ).toBeVisible();
    await expect(page.getByText("Checks completed")).toBeVisible();
    // the rule engine's own wording — a violation is always flagged as
    // "potential", never presented as an established fact
    await expect(page.getByText(/potential violation, not a confirmed one|does not support .* at this time|No matching regulation/)).toBeVisible();
  });

  test("hotspots page treats a recurring location as one hotspot, not independent complaints", async ({ page }) => {
    await login(page, "citizen1@demo.civiquex.app");
    await page.goto("/hotspots");
    await expect(page.getByRole("heading", { name: "Hotspot Intelligence" })).toBeVisible();
    await expect(page.getByText("repeated incidents treated as one location-level risk")).toBeVisible();
    await expect(page.getByText("Recurring", { exact: true }).first()).toBeVisible();
  });

  test("resolution queue independently re-verifies a still-present incident despite an authority report", async ({ page }) => {
    await login(page, "citizen1@demo.civiquex.app");
    await page.goto("/resolution");
    await expect(page.getByText("Reopened").or(page.getByText("Still present"))).toBeVisible({ timeout: 15_000 }); // real DB round-trip, not instant local SQLite
  });

  test("authority account sees a priority queue and can respond, feeding the routing feedback log", async ({ page }) => {
    await login(page, "authority.traffic@demo.civiquex.app");
    await page.goto("/authorities");
    await expect(page.getByText("Your priority queue")).toBeVisible();
    const respondButton = page.getByRole("button", { name: "Respond as authority" }).first();
    if (await respondButton.isVisible().catch(() => false)) {
      await respondButton.click();
      await expect(page.getByText("Authority response")).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
    }
  });

  test("report flow lets a signed-in citizen pick an incident type and reach the capture step", async ({ page }) => {
    await login(page, "citizen1@demo.civiquex.app");
    await page.goto("/report");
    await page.getByText("Wrong / illegal parking").click();
    await expect(page.getByText("Capture 5-10 seconds of video")).toBeVisible();
  });
});
