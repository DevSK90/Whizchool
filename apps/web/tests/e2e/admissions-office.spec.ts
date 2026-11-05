import { expect, open, signIn, test } from "./fixtures";

test("the office enters a walk-in application, and the student is enrolled on their date", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/admissions");
  await page.getByRole("link", { name: "New application" }).click();
  await page.waitForURL(/\/app\/admissions\/new/);

  await page.getByRole("combobox", { name: "Grade applying for" }).click();
  await page.getByRole("option", { name: "Grade 3" }).click();
  await page.fill("[id='student.firstName']", "Hasini");
  await page.fill("[id='student.lastName']", "Walkerage");
  await page.getByRole("combobox", { name: "Gender" }).click();
  await page.getByRole("option", { name: "Female" }).click();
  await page.locator("[id='student.dob']").click();
  await page.locator("[data-slot=popover-content]").getByRole("gridcell").getByRole("button").filter({ hasText: /^15$/ }).first().click();
  await page.fill("[id='student.address']", "4 Temple Road, Galle");
  await page.fill("[id='guardian.name']", "Mrs. Walkerage");
  await page.fill("[id='guardian.phone']", "0779998888");

  // Needs the parent's agreement, but not an email or documents.
  await page.getByRole("button", { name: "Save application" }).click();
  await expect(page.getByText("Please confirm with the parent")).toBeVisible();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Save application" }).click();

  await expect(page.getByText("Tracking number", { exact: true })).toBeVisible();
  const ref = (await page.locator("p.font-mono").textContent())!;
  await expect(page.getByText("The tracking number was also sent")).toBeVisible();

  // The parent tracks it with their phone number.
  await open(page, `/apply/status?ref=${ref}`);
  await page.fill("#contact", "077 999 8888");
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByText("Hasini Walkerage")).toBeVisible();

  // Accepted for a later date: Enroll waits, until the date comes forward to today.
  await open(page, "/app/admissions?search=Walkerage");
  await page.getByRole("link", { name: "Hasini Walkerage" }).click();
  await page.waitForURL(/\/app\/admissions\/app/);
  await page.getByRole("button", { name: "Accept" }).click();
  const accept = page.getByRole("dialog");
  await accept.getByRole("button", { name: "Accept" }).click();
  await expect(accept.getByText("Required")).toBeVisible();
  await accept.locator("#enrollmentDate").click();
  const calendar = page.locator("[data-slot=popover-content]");
  await calendar.getByRole("button", { name: /next/i }).click();
  await calendar.getByRole("gridcell").getByRole("button").filter({ hasText: /^15$/ }).first().click();
  await accept.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("The Enroll button opens on this date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enroll student" })).toBeDisabled();

  await page.getByRole("button", { name: "Change enrolment date" }).click();
  const change = page.getByRole("dialog");
  await change.locator("#enrollmentDate").click();
  // The calendar opens on the date already chosen, a month ahead.
  await calendar.getByRole("button", { name: /previous/i }).click();
  await calendar.locator("[data-today] button").first().click();
  await change.getByRole("button", { name: "Save date" }).click();
  await expect(page.getByText("The student can be enrolled now.")).toBeVisible();

  await page.getByRole("button", { name: "Enroll student" }).click();
  const enroll = page.getByRole("dialog");
  await enroll.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  // No email, so there's nobody to invite to the portal.
  await expect(enroll.getByText("Email the parent an invitation")).toHaveCount(0);
  await enroll.getByRole("button", { name: "Enroll", exact: true }).click();
  await expect(page.getByText("Student enrolled")).toBeVisible();
  await page.getByRole("link", { name: "View student profile" }).click();

  // The new student's page says what's left.
  await expect(page.getByText("Next steps for this new student")).toBeVisible();
  await expect(page.getByText("Add a profile photo")).toBeVisible();
  await expect(page.getByText("Add blood group and allergies")).toBeVisible();
});

test("an offer waits for its date, and a sample document says it has no file to open", async ({ page }) => {
  await signIn(page, "admin");
  // A seeded offer whose date is still to come.
  await open(page, "/app/admissions?stage=accepted");
  const later = page.getByRole("row").filter({ hasText: "5 Jan 2027" }).first();
  await later.getByRole("link").first().click();
  await page.waitForURL(/\/app\/admissions\/app/);
  await expect(page.getByRole("button", { name: "Enroll student" })).toBeDisabled();
  await page.getByRole("button", { name: /KB$/ }).first().click();
  await expect(page.getByText("This sample document has no file to open.")).toBeVisible();
});

test("a teacher can't enter applications", async ({ page }) => {
  await signIn(page, "teacher");
  await open(page, "/app/admissions");
  await expect(page.getByRole("link", { name: "New application" })).toHaveCount(0);
});
