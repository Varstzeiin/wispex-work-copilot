import { expect, test, type Page } from "@playwright/test";

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

test("report an error and walk the workflow to resolution", async ({ page }) => {
  await startDemo(page);
  await page.goto("/errors/new");
  const submit = page.getByRole("button", { name: "Report error" });
  await page.getByLabel("Exact field").fill("Gross weight");
  await expect(submit).toBeDisabled(); // stop-and-verify not confirmed yet
  await page.getByLabel("I stopped and verified").check();
  await page.getByLabel("Submitted (wrong) value").fill("850 KG");
  await page.getByLabel("Correct value", { exact: true }).fill("890 KG");
  await page.getByLabel("Source document of the correct value").fill("Packing List");
  await snap(page, "11-report-error");
  await submit.click();

  await expect(page.getByText("Next: notify the appropriate person")).toBeVisible();
  await page.getByLabel("Who did you notify?").fill("Supervisor");
  await page.getByRole("button", { name: "I have notified them" }).click();

  await page.getByLabel("What correction are you preparing?").fill("Amendment with 890 KG");
  await page.getByRole("button", { name: "Correction prepared" }).click();

  await page.getByLabel("How was it resolved?").fill("Amendment accepted");
  await page.getByRole("button", { name: "Mark as resolved" }).click();

  await expect(page.getByText("Next: root-cause analysis")).toBeVisible();
  await page.getByLabel("Prevention step").fill("Check gross vs net before submit");
  await page.getByRole("button", { name: "Save root-cause analysis" }).click();
  await expect(page.getByText("Prevention: Check gross vs net before submit")).toBeVisible();
  await snap(page, "12-error-resolved");
});

test("error analytics shows recurring pattern as a suggestion", async ({ page }) => {
  await startDemo(page);
  await page.goto("/errors");
  await page.getByRole("tab", { name: "Analytics" }).click();
  await expect(page.getByText(/three weight-related errors/)).toBeVisible();
  await expect(page.getByText("Official SOP is never modified")).toBeVisible();
  await snap(page, "13-error-analytics");
  await page.getByRole("button", { name: "Add as a learning item" }).click();
  await expect(page.getByText("Added to your learning tracker.")).toBeVisible();
});

test("end-of-shift and weekly reviews", async ({ page }) => {
  await startDemo(page);
  await page.goto("/reviews");
  await expect(page.getByText(/you completed/)).toBeVisible();
  await page.getByLabel("What went well?").fill("Verified every weight");
  await page.getByRole("button", { name: "Save reflection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await snap(page, "14-shift-review");

  await page.getByRole("tab", { name: "Weekly" }).click();
  await expect(page.getByRole("heading", { name: "Tasks completed per day" })).toBeVisible();
  await snap(page, "15-weekly-review");
});

test("learning, skills and growth", async ({ page }) => {
  await startDemo(page);
  await page.goto("/learning");
  await expect(page.getByText("Packing List: gross vs net weight")).toBeVisible();
  await page.getByRole("tab", { name: "Skill matrix" }).click();
  await page.getByRole("radio", { name: "4: Can teach others" }).first().click();
  await expect(page.getByText("4/4").first()).toBeVisible();
  await snap(page, "16-skills");

  await page.goto("/growth");
  await expect(page.getByText("Personal Reliability Indicators")).toBeVisible();
  await expect(page.getByText("not an official company evaluation")).toBeVisible();
  await snap(page, "17-indicators");
  await page.getByRole("tab", { name: "30 / 60 / 90 days" }).click();
  await expect(page.getByText("Day 41")).toBeVisible();
  await expect(page.getByText("Current phase")).toBeVisible();
  await snap(page, "18-plan");
});
