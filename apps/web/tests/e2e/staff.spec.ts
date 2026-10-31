import { expect, open, signIn, test } from "./fixtures";

test("admin adds a staff member with no login, finds them, and marks them as left", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/staff");
  await page.getByRole("link", { name: "Add staff member" }).click();
  await page.waitForURL(/\/app\/staff\/new/);

  // Asks for the essentials first.
  await page.getByRole("button", { name: "Add staff member" }).click();
  await expect(page.locator("[data-invalid=true]").first()).toBeVisible();

  await page.getByRole("combobox", { name: "Title" }).click();
  await page.getByRole("option", { name: "Mrs." }).click();
  await page.locator("#name").fill("Padma Lokuge");
  await page.locator("#phone").fill("077 123 4567");
  await page.getByRole("combobox", { name: "Staff type" }).click();
  await page.getByRole("option", { name: "Non-academic" }).click();
  await page.locator("#designation").fill("Canteen Manager");
  await page.locator("#joinedOn").click();
  await page.getByRole("dialog").getByRole("gridcell").getByRole("button").filter({ hasText: /^15$/ }).first().click();
  await page.locator("#nic").fill("851234567V");
  await page.getByRole("button", { name: "Add staff member" }).click();

  await page.waitForURL(/\/app\/staff\/st/);
  await expect(page.getByRole("heading", { name: /Mrs\. Padma Lokuge/ })).toBeVisible();
  await expect(page.getByText("851234567V")).toBeVisible();
  await expect(page.getByText("No login.")).toBeVisible();

  await open(page, "/app/staff");
  await page.getByRole("searchbox").fill("Lokuge");
  await page.getByRole("cell", { name: "Mrs. Padma Lokuge" }).click();
  await page.waitForURL(/\/app\/staff\/st/);

  await page.getByRole("button", { name: "Mark as left" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason for leaving").fill("Resigned");
  await dialog.getByRole("button", { name: "Mark as left" }).click();
  await expect(page.getByRole("button", { name: "Mark as returned" })).toBeVisible();
  await expect(page.getByText("Resigned")).toBeVisible();
});

test("a teacher with classes can't be marked as left until they're handed over", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/staff?search=Kasun");
  await page.getByRole("link", { name: "Mr. Kasun Fernando" }).click();
  await page.waitForURL(/\/app\/staff\/st/);
  await page.getByRole("button", { name: "Mark as left" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("They still have these classes")).toBeVisible();
  await expect(dialog.getByRole("link").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark as left" })).toHaveCount(0);
});

test("a teacher doesn't get the staff section", async ({ page }) => {
  await signIn(page, "teacher");
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
});
