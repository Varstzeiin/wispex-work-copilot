import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function startDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo (fictional data)" }).click();
  await expect(page.getByText("DEMO DATA.")).toBeVisible();
  // The demo always has deadline alerts: one compact toast appears and can be dismissed
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(dismiss).toBeHidden();
}

test("redirects to login without a session", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Do not upload or enter confidential")).toBeVisible();
  await snap(page, "01-login");
});

test("demo dashboard explains what to work on next", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText("Needs attention")).toBeVisible();
  await snap(page, "02-dashboard");

  await page.getByRole("button", { name: "What should I work on now?" }).click();
  await expect(page.getByText(/is recommended because/)).toBeVisible();
  await snap(page, "03-next-action");
});

test("task inbox, detail, planner and focus mode", async ({ page, isMobile }) => {
  await startDemo(page);

  if (isMobile) await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).click();
  else await page.getByRole("link", { name: "Tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "Task Inbox" })).toBeVisible();
  await snap(page, "04-inbox");

  await page.getByRole("button", { name: /^Critical/ }).click();
  await expect(page.getByText("SHP-001").first()).toBeVisible();

  // Debounced search
  await page.getByRole("button", { name: "All open" }).click();
  await page.getByLabel("Search tasks").fill("SHP-003");
  await expect(page.getByRole("link", { name: /SHP-003/ })).toHaveCount(1);
  await page.getByRole("link", { name: /SHP-003/ }).click();

  await expect(page.getByRole("heading", { name: "SHP-003" })).toBeVisible();
  await expect(page.getByText("Quantity mismatch").first()).toBeVisible();
  await expect(page.getByText("Why this priority")).toBeVisible();
  await snap(page, "05-task-detail");

  await page.goto("/planner");
  await expect(page.getByText("Recommended order")).toBeVisible();
  await snap(page, "06-planner");

  await page.goto("/focus");
  await expect(page.getByText("FOCUS MODE", { exact: true })).toBeVisible();
  await expect(page.getByText("Next action", { exact: true })).toBeVisible();
  await snap(page, "07-focus");
});

test("create, progress and complete a task with verification", async ({ page }) => {
  await startDemo(page);
  await page.goto("/tasks/new");
  await page.getByLabel("Shipment reference").fill("SHP-E2E");
  await page.getByLabel("Client", { exact: true }).fill("Client Z");
  await page.getByLabel("Submission deadline").fill("2030-01-01T10:00");
  await page.getByRole("button", { name: "Commercial Invoice" }).first().isVisible();
  await snap(page, "08-new-task");
  await page.getByRole("button", { name: "Create task" }).click();

  await expect(page.getByRole("heading", { name: "SHP-E2E" })).toBeVisible();
  // Default required docs: none received yet, so completing is blocked
  await expect(page.getByText("0 / 3")).toBeVisible();

  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByText("In progress").first()).toBeVisible();

  for (const doc of ["Commercial Invoice", "Packing List", "Bill of Lading"]) {
    await page.getByRole("button", { name: new RegExp(`^${doc}\\s+Missing`) }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${doc}\\s+Received`) })).toBeVisible();
  }

  await page.getByRole("button", { name: "Complete" }).click();
  const confirm = page.getByRole("button", { name: "Mark as completed" });
  await expect(confirm).toBeDisabled();
  // Personal final checklist + verification confirmation must all be ticked
  const boxes = page.getByRole("dialog").getByRole("checkbox");
  await expect(boxes).toHaveCount(11);
  for (let i = 0; i < 10; i++) await boxes.nth(i).check();
  await expect(confirm).toBeDisabled();
  await boxes.nth(10).check();
  await confirm.click();
  await expect(page.getByText("Completed").first()).toBeVisible();

  await page.goto("/activity");
  await expect(page.getByText("Task completed").first()).toBeVisible();
});

test("calendar reminder is honest about the missing integration", async ({ page }) => {
  await startDemo(page);
  await page.goto("/tasks?level=CRITICAL");
  await page.getByRole("link", { name: /SHP-001/ }).click();
  await page.getByRole("button", { name: "Add calendar reminder" }).click();
  await expect(page.getByText(/Saved in Wispex/)).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByText("Integration Required")).toBeVisible();
  await expect(page.getByText("WISPEX — SHP-001 Submission Deadline")).toBeVisible();
  await snap(page, "09-calendar");
});

test("login page: Google button only when the server offers it", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/Google sign-in: Integration Required/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);

  await page.route("**/api/auth/providers", (route) => route.fulfill({ json: { google: true } }));
  await page.goto("/login?google=email_exists");
  const google = page.getByRole("link", { name: "Continue with Google" });
  await expect(google).toHaveAttribute("href", "/api/auth/google/start");
  await expect(page.getByText(/An account with this email already exists/)).toBeVisible();
  await snap(page, "11-login-google");
});

test("login page explains when the backend cannot be reached", async ({ page }) => {
  // What a hosting platform returns when /api is not forwarded to a running backend
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: "<html>Not found</html>" }),
  );
  await page.goto("/login");
  await expect(page.getByText(/The server is not reachable right now, so signing in will not work/)).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "Nothing was changed" })).toBeVisible();
});
