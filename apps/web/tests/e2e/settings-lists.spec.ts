import { expect, open, signIn, test } from "./fixtures";

test("school settings use the full width, and only offer to save once something changed", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/settings");
  await expect(page.getByText("School details")).toBeVisible();
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  const motto = page.locator("#s-motto");
  const before = await motto.inputValue();
  await motto.fill(`${before}!`);
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(motto).toHaveValue(before);
  await expect(save).toBeDisabled();

  // The cards stretch across the page rather than stopping at a fixed width.
  const card = await page.getByText("School details").locator("xpath=ancestor::*[@data-slot='card'][1]").boundingBox();
  const main = await page.locator("#main").boundingBox();
  expect(card!.width * 2).toBeGreaterThan(main!.width * 0.8);
});

test("term tests & marks and defaulters show 25 rows a page", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/exams");
  const pager = page.getByText(/^Showing 1–25 of \d+/);
  await expect(pager).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(26);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/^Showing 26–50 of \d+/)).toBeVisible();
  await expect(page).toHaveURL(/page=2/);

  await open(page, "/app/fees/defaulters");
  await expect(page.getByText(/^Showing 1–25 of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/^Showing 26–50 of \d+/)).toBeVisible();
  // Select all still means every matching student, not just this page.
  await page.getByRole("checkbox", { name: /^Select all \d+ students/ }).click();
  await expect(page.getByRole("button", { name: /^Remind \d{2,} selected$/ })).toBeVisible();
});
