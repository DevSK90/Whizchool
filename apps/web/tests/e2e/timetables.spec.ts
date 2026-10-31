import { expect, open, signIn, test } from "./fixtures";

test("admin drags a lesson onto the board and publishes it; the teacher and the parent see it", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/timetables");
  await page.getByRole("cell", { name: "10-A", exact: true }).click();
  await page.waitForURL(/\/app\/timetables\/cls_2026_10a/);

  // Take a Maths lesson off the board.
  const lessons = page.getByRole("button", { name: /^Mathematics · / });
  await lessons.first().waitFor();
  const before = await lessons.count();
  const lesson = lessons.first();
  const label = (await lesson.getAttribute("aria-label"))!;
  const time = label.split(" · ")[1]!;
  const box = (await lesson.boundingBox())!;
  await lesson.click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(lessons).toHaveCount(before - 1);
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  // Drag it back from the tray: it lands where the pointer lets go, at that time.
  const card = page.locator("aside button", { hasText: "Mathematics" });
  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 5, { steps: 3 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await expect(page.getByText(time)).toBeVisible();
  await page.mouse.up();
  await expect(lessons).toHaveCount(before);
  const placed = page.getByRole("button", { name: `Mathematics · ${time}`, exact: false });
  await expect(placed).toHaveCount(1);

  // Pull its bottom edge up by 20 minutes.
  const placedBox = (await placed.boundingBox())!;
  await page.mouse.move(placedBox.x + placedBox.width / 2, placedBox.y + placedBox.height - 3);
  await page.mouse.down();
  await page.mouse.move(placedBox.x + placedBox.width / 2, placedBox.y + placedBox.height - 43, { steps: 6 });
  await page.mouse.up();
  const start = time.split(" – ")[0]!;
  const shorter = page.getByRole("button", { name: new RegExp(`^Mathematics · ${start} – `) });
  const shortLabel = (await shorter.getAttribute("aria-label"))!;
  expect(shortLabel).not.toContain(time);
  const shortTime = shortLabel.split(" · ")[1]!;

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unsaved changes")).toBeHidden();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("10-A timetable published")).toBeVisible();

  // The class's teachers see the published week.
  await page.evaluate(() => localStorage.removeItem("wz_mock_session"));
  await signIn(page, "teacher");
  await open(page, "/app/timetables/me");
  await expect(page.locator(`[title*="${shortTime}"]`).first()).toBeVisible();

  // So does a parent of a child in the class.
  await page.evaluate(() => localStorage.removeItem("wz_mock_session"));
  await signIn(page, "parent");
  const child = await page.locator('a[href*="/portal/children/"]').first().getAttribute("href");
  await open(page, `/portal/children/${child!.split("/")[3]}`);
  await page.getByRole("tab", { name: "Timetable" }).click();
  await expect(page.locator(`[title*="${shortTime}"]`).first()).toBeVisible();
});

test("a clash shows on the board and stops publishing", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/timetables/cls_2026_8b");
  const lesson = page.getByRole("button", { name: / · 7:40 am – 8:20 am/ }).first();
  await lesson.waitFor();
  await lesson.click();
  const dialog = page.getByRole("dialog");
  // The same room as another class, at a time every other class is in its own.
  await dialog.getByLabel("Room").fill("S10A");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Room S10A is used by 10-A/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
});
