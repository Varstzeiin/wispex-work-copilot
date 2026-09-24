import { expect, test, type Page } from "@playwright/test";

/**
 * Document intelligence (MVP 3). The backend for these tests runs with AI_PROVIDER=fake,
 * a deterministic stand-in: no real AI provider and no real company data are involved.
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

test("demo: discrepancy shows both values and needs a recorded resolution", async ({ page }) => {
  await startDemo(page);
  await page.goto("/documents");
  await expect(page.getByText("Do not upload confidential")).toBeVisible();
  await expect(page.getByText("Demo account: uploads are never sent to an AI provider.")).toBeVisible();
  await snap(page, "20-documents");

  await page.getByRole("link", { name: /SHP-004/ }).click();
  await expect(page.getByText("3 / 3 documents available")).toBeVisible();
  const card = page.locator("section").filter({ hasText: "Potential mismatch: Net weight" });
  await expect(card.getByText("850", { exact: true })).toBeVisible();
  await expect(card.getByText("890", { exact: true })).toBeVisible();
  await expect(card.getByText("40 KG")).toBeVisible();
  await expect(card.getByText(/cannot determine which value is correct/)).toBeVisible();
  await snap(page, "21-shipment-check");

  await card.getByRole("button", { name: "Record resolution" }).click();
  const save = page.getByRole("dialog").getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Which value applies, and who confirmed it?").fill("Supervisor confirmed 890 KG from the scale ticket");
  await save.click();
  await expect(page.getByText("Closed discrepancies")).toBeVisible();

  await page.getByRole("link", { name: "Open task" }).click();
  await expect(page.getByText("Supervisor confirmed 890 KG", { exact: false }).first()).toBeVisible();
});

test("demo: review queue and choosing a document version", async ({ page }) => {
  await startDemo(page);
  await page.goto("/documents");
  await page.getByRole("tab", { name: /Review queue/ }).click();
  await page.getByRole("link", { name: /Gross weight/ }).first().click();
  await expect(page.getByText("AI 62%")).toBeVisible();
  await snap(page, "22-document-review");
  const row = page.getByRole("listitem").filter({ hasText: "Gross weight" });
  await row.getByRole("button", { name: "Confirm value" }).click();
  await expect(row.getByText("Verified by you")).toBeVisible();

  await page.goto("/documents/shipment/SHP-006");
  await expect(page.getByText(/2 versions of the Invoice: choose the one that applies/)).toBeVisible();
  await page.getByRole("link", { name: /SHP-006_Invoice_v2/ }).click();
  await expect(page.getByText("The newest file is not assumed to be correct.")).toBeVisible();
  await page.getByRole("button", { name: "Use this version" }).first().click();
  await expect(page.getByText("Chosen", { exact: true })).toBeVisible();
});

test("real account with (fake) AI: upload, background analysis, cross-document check", async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-e2e-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  // Switching AI on needs an explicit policy confirmation
  await page.goto("/settings#documents");
  // The switch only changes after the confirmation dialog, so click (not check)
  await page.getByLabel("AI document reading").click();
  const turnOn = page.getByRole("button", { name: "Turn on" });
  await expect(turnOn).toBeDisabled();
  await page.getByLabel(/my organization's policy explicitly permits/).check();
  await turnOn.click();
  await expect(page.getByText("AI document reading switched on.")).toBeVisible();

  const files = [];
  for (const key of ["invoice", "packing_list", "bill_of_lading"]) {
    const res = await page.request.get(`/api/documents/samples/${key}`);
    const name = /filename="([^"]+)"/.exec(res.headers()["content-disposition"] ?? "")![1];
    files.push({ name, mimeType: "application/pdf", buffer: await res.body() });
  }

  await page.goto("/documents/upload");
  await page.locator("#file-input").setInputFiles(files);
  await expect(page.getByText("SHP-DEMO-7_Invoice_v1.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Upload 3 files" }).click();
  await expect(page.getByText(/being analysed in the background/)).toBeVisible();
  await snap(page, "23-upload-result");

  await page.goto("/documents");
  const group = page.getByRole("link", { name: /SHP-DEMO-7/ });
  await expect(group).toBeVisible({ timeout: 15_000 });
  await expect(group.getByText("3 / 3 documents")).toBeVisible();
  await group.click();
  await expect(page.getByText("Potential mismatch: Quantity")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Potential mismatch: Net weight")).toBeVisible();
  await snap(page, "24-fake-ai-check");

  // Duplicate upload is detected by checksum
  await page.goto("/documents/upload");
  await page.locator("#file-input").setInputFiles(files[0]);
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(page.getByText(/This exact file was already uploaded/)).toBeVisible();
});
