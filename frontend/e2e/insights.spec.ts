import { expect, test, type Page } from "@playwright/test";

/**
 * MVP 5: forecast, patterns, analytics and approved sending. Demo data is fictional.
 * The email test runs only when the backend has an email server configured (a local SMTP sink in CI).
 */

const shots = process.env.E2E_SCREENSHOTS;

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function startDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo (fictional data)" }).click();
  await expect(page.getByText("DEMO DATA.")).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
}

test("demo: workload forecast, patterns and analytics", async ({ page }) => {
  await startDemo(page);
  await page.goto("/insights");
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await expect(page.getByText(/Bar: expected work\. Line: your shift\./)).toBeVisible();
  await expect(page.getByText("How long your tasks really take")).toBeVisible();
  await snap(page, "40-forecast");

  await page.getByRole("tab", { name: "Patterns" }).click();
  await expect(page.getByText("Patterns per client are off.", { exact: false })).toBeVisible();
  const card = page.locator("section").filter({ hasText: "Air shipments take longer than estimated" });
  await expect(card).toBeVisible();
  await expect(page.getByText(/Client B:/)).toHaveCount(0);
  await snap(page, "41-patterns");
  await card.getByRole("button", { name: "Add to learning" }).click();
  await expect(page.getByText(/Added to your learning tracker/)).toBeVisible();

  await page.getByRole("tab", { name: "Analytics" }).click();
  await expect(page.getByText("Estimate vs actual")).toBeVisible();
  await snap(page, "42-analytics");

  // Client-level patterns only after an explicit policy confirmation
  await page.goto("/settings#automation");
  await expect(page.getByText(/No email server is configured|Not available for demo accounts/).first()).toBeVisible();
  await page.getByLabel("Patterns per client").click();
  const turnOn = page.getByRole("dialog").getByRole("button", { name: "Turn on" });
  await expect(turnOn).toBeDisabled();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await turnOn.click();
  await expect(page.getByText("Patterns per client: on.")).toBeVisible();
  await page.goto("/insights");
  await page.getByRole("tab", { name: "Patterns" }).click();
  await expect(page.getByText("Client B: documents often arrive late")).toBeVisible();
});

test("real account: send a reviewed draft by email after approval", async ({ page }) => {
  const email = `e2e-mail-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-e2e-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  const status = await (await page.request.get("/api/automation/status")).json();
  test.skip(!status.email_configured, "No email server configured on the backend");

  await page.goto("/settings#automation");
  await page.getByLabel("Send drafts by email").click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("dialog").getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Send drafts by email: on.")).toBeVisible();

  await page.goto("/tasks/new");
  await page.getByLabel("Shipment reference").fill("SHP-MAIL");
  await page.getByLabel("Client", { exact: true }).fill("Client M");
  await page.getByLabel("Submission deadline").fill("2030-01-01T10:00");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("heading", { name: "SHP-MAIL" })).toBeVisible();

  await page.getByRole("link", { name: "Draft message" }).click();
  await page.getByLabel("Message type").selectOption("STATUS_UPDATE");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  const saved = page.locator("li").filter({ hasText: "SHP-MAIL: Status update" }).first();
  await saved.locator("summary").click();
  await saved.getByRole("button", { name: "Send by email…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("To").fill("ops@example.com");
  const send = dialog.getByRole("button", { name: "Send email" });
  await expect(send).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await snap(page, "43-send-email");
  await send.click();
  await expect(saved.getByText("Emailed")).toBeVisible();
  await expect(saved.getByRole("button", { name: "Send by email…" })).toHaveCount(0);
});
