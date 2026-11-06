import { expect, signIn, test } from "./fixtures";

test("the parent home fits a phone screen without sideways scrolling", async ({ page }) => {
  await signIn(page, "parent");
  await expect(page.getByText("Kavindu Perera", { exact: true })).toBeVisible();
  await expect(page.getByText("Coming up", { exact: true })).toBeVisible();
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
});
