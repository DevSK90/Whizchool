import { expect, open, signIn, test } from "./fixtures";

test("visitor applies, tracks status, and the admin enrolls the applicant", async ({ page }) => {
  await open(page, "/apply");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.click();
  await expect(page.getByText("Required").first()).toBeVisible();

  await page.locator("#applyingGradeId").click();
  await page.getByRole("option", { name: "Grade 6" }).click();
  await page.fill("[id='student.firstName']", "Senuri");
  await page.fill("[id='student.lastName']", "Gunawardena");
  await page.locator("[id='student.gender']").click();
  await page.getByRole("option", { name: "Female" }).click();
  await page.locator("[id='student.dob']").click();
  const calendar = page.locator("[data-slot=popover-content]");
  await calendar.locator("select").nth(1).selectOption("2015");
  await calendar.locator("select").nth(0).selectOption({ label: "Apr" });
  await calendar.getByRole("button", { name: /April 12/ }).click();
  await page.fill("[id='student.address']", "21 Lake Drive, Kandy");
  await next.click();

  await page.fill("[id='guardian.name']", "Mrs. Chandima Gunawardena");
  // One digit short: rejected before it can reach the SMS gateway.
  await page.fill("[id='guardian.phone']", "077 123 456");
  await page.fill("[id='guardian.email']", "chandima.g@example.com");
  await next.click();
  await expect(page.getByText("Enter a 9-digit mobile number")).toBeVisible();
  await page.fill("[id='guardian.phone']", "077 555 1234");
  await next.click();

  await next.click();
  await expect(page.getByText("The birth certificate is required.")).toBeVisible();
  await page.locator("input[type=file]").first().setInputFiles({ name: "birth.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(page.getByText(/birth\.pdf/)).toBeVisible();
  await next.click();

  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Application received")).toBeVisible();
  await expect(page.getByText(/APP-\d{4}-\d{4}/).first()).toBeVisible();

  await page.getByRole("link", { name: "Track application status" }).click();
  await page.fill("#email", "chandima.g@example.com");
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByText("Senuri Gunawardena")).toBeVisible();

  // Same browser, so the same mock data: the admin processes the application.
  await signIn(page, "admin");
  await open(page, "/app/admissions?stage=new");
  await page.getByRole("link", { name: "Senuri Gunawardena" }).click();
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Enroll student" }).click();
  await page.getByRole("dialog").getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Enroll" }).click();
  await expect(page.getByText("Student enrolled")).toBeVisible();
  await page.getByRole("link", { name: "View student profile" }).click();
  await expect(page.getByRole("heading", { name: /Senuri Gunawardena/ })).toBeVisible();

  // The applicant's upload was copied onto the student record.
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByRole("tabpanel").getByText(/birth\.pdf/).first()).toBeVisible();
});
