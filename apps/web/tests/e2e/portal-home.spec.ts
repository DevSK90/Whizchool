import { expect, signIn, test } from "./fixtures";

test("the parent home shows what needs attention, each child's details and what's coming up", async ({ page }) => {
  await signIn(page, "parent");
  // Kavindu's fees have been overdue since the demo school's first term.
  await expect(page.getByRole("heading", { name: /^Needs your attention/ })).toBeVisible();
  await expect(page.getByText(/^Kavindu has LKR [\d,]+ in overdue fees$/)).toBeVisible();
  await expect(page.getByText(/Class teacher: /)).toHaveCount(2);
  await expect(page.getByText(/^Term \d Test 2026$/).first()).toBeVisible();
  await expect(page.getByText("Coming up", { exact: true })).toBeVisible();

  // The children's cards fill the main column beside a side column.
  const main = await page.locator("#main").boundingBox();
  const card = await page.getByText("Kavindu Perera", { exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]").boundingBox();
  expect(card!.width).toBeGreaterThan(main!.width * 0.55);

  // A notice opens where it is on the notices page.
  const notice = page.locator('a[href^="/portal/notices#notice-"]').first();
  const title = (await notice.locator("span").first().innerText()).trim();
  await notice.click();
  await expect(page).toHaveURL(/\/portal\/notices#notice-/);
  await expect(page.locator("[id^='notice-']").first()).toContainText(title);
});
