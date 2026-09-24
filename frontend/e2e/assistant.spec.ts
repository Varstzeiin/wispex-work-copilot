import { expect, test, type Page } from "@playwright/test";

/**
 * AI copilot (MVP 4). The backend for these tests runs with AI_PROVIDER=fake, a deterministic
 * stand-in: no real AI provider and no real company data are involved.
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

test("demo: search knowledge first, then ask a precise question and record the answer", async ({ page }) => {
  await startDemo(page);
  await page.goto("/assistant");
  await page.getByLabel("Your question").fill("What if the quantity differs between Invoice and Packing List?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/closest matches in your trusted sources/)).toBeVisible();
  await expect(page.getByText(/SOP-DEMO-03, section 2/).first()).toBeVisible();
  await snap(page, "30-assistant");

  await page.goto("/tasks");
  await page.getByLabel("Search tasks").fill("SHP-003");
  await page.getByRole("link", { name: /SHP-003/ }).click();
  await page.getByRole("link", { name: "I'm not sure" }).click();

  await expect(page.getByRole("heading", { name: "I'm not sure" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Task", exact: true })).toHaveValue(/.+/);
  await page.getByLabel("Field or topic").fill("Quantity");
  await page.getByLabel("What is unclear?").fill("Invoice and Packing List quantities differ");
  await page.getByLabel("What do you need to know? (optional)").fill("which value should be used");
  await page.getByRole("button", { name: "Check sources and draft a question" }).click();

  await expect(page.getByText("Ask a precise question", { exact: true })).toBeVisible();
  const question = page.getByLabel("Question text");
  await expect(question).toHaveValue(/shipment SHP-003 for Client A/);
  await expect(question).toHaveValue(/The Invoice shows 1,500 while the Packing List shows 1,550/);
  await expect(question).toHaveValue(/Could you please advise which value should be used when you have a moment\?$/);
  await snap(page, "31-unsure");

  await page.getByRole("button", { name: "I asked this question" }).click();
  await expect(page.getByRole("heading", { name: "SHP-003" })).toBeVisible();
  await expect(page.getByText("Asked Senior: Quantity").first()).toBeVisible();

  await page.getByRole("button", { name: "Record answer" }).click();
  await page.getByLabel("Answer you received").fill("Use 1,550 from the Packing List, confirmed by the shipper.");
  await page.getByText(/came from a senior, supervisor or official source/).click();
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByRole("button", { name: "Record answer" })).toHaveCount(0);

  await page.goto("/knowledge");
  await page.getByLabel("Search knowledge").fill("quantities differ confirmed shipper");
  await expect(page.getByText(/Use 1,550 from the Packing List/).first()).toBeVisible();
});

test("demo: draft a message, copy it and mark it as sent by yourself", async ({ page }) => {
  await startDemo(page);
  await page.goto("/assistant/drafts");
  await page.getByLabel("Message type").selectOption("MISSING_DOCUMENT");
  const task = page.getByRole("combobox", { name: "Task", exact: true });
  const value = await task.locator("option", { hasText: "SHP-002" }).getAttribute("value");
  await task.selectOption(value!);
  await page.getByRole("button", { name: "Generate draft" }).click();
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toHaveValue(/I have not yet received the Packing List\./);
  await expect(page.getByText(/never sends messages/)).toBeVisible();
  await snap(page, "32-draft");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  const saved = page.locator("li").filter({ hasText: "SHP-002: Missing documents" }).first();
  await saved.locator("summary").click();
  await saved.getByRole("button", { name: "I sent it myself" }).click();
  await expect(saved.getByText("Sent by you")).toBeVisible();
});

test("demo: checklist suggestion is only added after confirmation", async ({ page }) => {
  await startDemo(page);
  await page.goto("/assistant");
  await expect(page.getByText(/three weight-related errors/)).toBeVisible();
  await page.getByRole("button", { name: "Review and add" }).click();
  await page.getByLabel("Checklist item (you can change the wording)").fill("Gross and net weight checked against the Packing List");
  await page.getByRole("button", { name: "Add to my checklist" }).click();
  await expect(page.getByText(/Added to your final checklist/)).toBeVisible();

  await page.goto("/settings#documents");
  await expect(page.getByText("Gross and net weight checked against the Packing List")).toBeVisible();
});

test("real account with (fake) AI: answer only from saved knowledge", async ({ page }) => {
  const email = `e2e-kb-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-e2e-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  await page.goto("/settings#assistant");
  await page.getByLabel("AI writing help").click();
  const turnOn = page.getByRole("dialog").getByRole("button", { name: "Turn on" });
  await expect(turnOn).toBeDisabled();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await turnOn.click();
  await expect(page.getByText("AI writing help switched on.")).toBeVisible();

  await page.goto("/assistant");
  await page.getByLabel("Your question").fill("Does gross weight include packaging?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No reliable source found. Please verify with the appropriate person.")).toBeVisible();

  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Title").fill("Gross weight vs net weight");
  await page.getByLabel("Content").fill("Gross weight includes packaging. Net weight excludes packaging.");
  await page.getByLabel("Source", { exact: true }).fill("Training week 1");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Gross weight vs net weight")).toBeVisible();

  await page.goto("/assistant");
  await page.getByLabel("Your question").fill("Does gross weight include packaging?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Answer from your sources")).toBeVisible();
  await expect(page.getByText("Gross weight includes packaging. [1]")).toBeVisible();
  await snap(page, "33-ai-answer");

  // With the local model loaded, a question with none of the note's words still finds it
  if (await page.getByText(/Search by meaning is on/).isVisible()) {
    await page.getByLabel("Your question").fill("Is the heavier figure with the boxes?");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Similar meaning")).toBeVisible();
    await expect(page.getByText("Answer from your sources")).toBeVisible();
    await snap(page, "34-meaning");
  }
});
