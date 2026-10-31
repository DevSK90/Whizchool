import { expect, open, signIn, test } from "./fixtures";

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("admin manages a student's photo, documents and guardians", async ({ page }) => {
  await signIn(page, "admin");
  await open(page, "/app/students?search=Perera");
  await page.getByRole("table").getByRole("link").first().click();
  await page.getByRole("tab", { name: "Overview" }).waitFor();

  // Photo
  await page.getByRole("button", { name: "Add photo" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Add photo" }).click();
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Photo updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  // Documents
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByText("No documents yet.")).toBeVisible();
  await page.getByRole("combobox", { name: "Document type" }).click();
  await page.getByRole("option", { name: "Medical document" }).click();
  const docChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload document" }).click();
  await (await docChooser).setFiles({ name: "medical.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(page.getByText("Document uploaded.")).toBeVisible();
  await expect(page.getByText("medical.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No documents yet.")).toBeVisible();

  // Guardians
  await page.getByRole("tab", { name: "Guardians" }).click();
  await page.getByRole("button", { name: "Add guardian" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Mr. Ruwan Wijewardena");
  await dialog.getByLabel("Phone", { exact: true }).fill("071 999 8888");
  await dialog.getByLabel("Email", { exact: true }).fill("ruwan.p@example.com");
  await dialog.getByRole("button", { name: "Add guardian" }).click();
  await expect(page.getByText("Guardian added.")).toBeVisible();
  await expect(page.getByText("Mr. Ruwan Wijewardena")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).last().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Guardian removed.")).toBeVisible();
});
