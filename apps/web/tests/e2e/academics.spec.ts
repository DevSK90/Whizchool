import { expect, open, signIn, test } from "./fixtures";

test("teacher marks attendance and submits a marks sheet", async ({ page }) => {
  await signIn(page, "teacher");
  await page.getByRole("link", { name: "Mark now" }).click();
  await page.waitForURL(/\/app\/attendance\//);
  await page.getByRole("radio", { name: "Absent" }).first().click();
  await page.getByRole("button", { name: /Save attendance/ }).click();
  // Parents are only texted about today's register; at weekends the page opens on Friday's.
  const weekend = [0, 6].includes(new Date().getDay());
  await expect(page.getByText(weekend ? /No absence SMS needed/ : /absence SMS queued/)).toBeVisible();

  await open(page, "/app/exams/exam_2026_3/marks?classId=cls_2026_10b&subjectId=sub_mat");
  const inputs = page.locator("tbody input");
  await inputs.first().waitFor();
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    if (!(await inputs.nth(i).inputValue())) await inputs.nth(i).fill(i % 7 === 0 ? "AB" : String(45 + (i % 50)));
  }
  await inputs.nth(1).fill("120");
  await expect(page.getByText("0–100 or AB").first()).toBeVisible();
  await inputs.nth(1).fill("88");
  await page.getByRole("button", { name: "Submit & lock" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit & lock" }).click();
  await expect(page.getByText("Submitted — this sheet is locked.")).toBeVisible();
});

test("principal opens the batch print view for a released class", async ({ page }) => {
  await signIn(page, "principal");
  // Term 2 results are already released in the seed data.
  await open(page, "/app/report-cards/exam_2026_2/class/cls_2026_10a");
  await page.getByRole("link", { name: "Print all report cards" }).click();
  await page.waitForURL(/\/print$/);
  await expect(page.getByRole("button", { name: "Print all" })).toBeVisible();
  const cards = page.locator(".break-after-page");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(10);
});

test("a class's mark schedule lists every student's marks, and exports them", async ({ page }) => {
  await signIn(page, "principal");
  await open(page, "/app/report-cards/exam_2026_2/class/cls_2026_10a");
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Mathematics", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Basket I", exact: true })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "Class average" })).toBeVisible();
  // Rank 1 first, with a mark under each compulsory subject.
  const first = table.getByRole("row").nth(1);
  await expect(first.getByRole("rowheader")).toContainText(/^\s*1/);
  await expect(first.getByRole("cell").first()).toHaveText(/\d|AB/);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Excel (CSV)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^10-A .*marks\.csv$/);
  const csv = await (await file.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString("utf8");
  expect(text.split("\r\n")[0]).toContain("Mathematics");
  expect(text.split("\r\n").length).toBeGreaterThan(10);

  // Remarks and the individual report cards are a tab away.
  await page.getByRole("tab", { name: "Report cards & remarks" }).click();
  await expect(page.getByRole("link", { name: "View" }).first()).toBeVisible();
});
