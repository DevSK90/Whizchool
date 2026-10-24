import { expect, open, signIn, test } from "./fixtures";

test("parent pays fees on a phone through the PayHere sandbox", async ({ page }) => {
  await signIn(page, "parent");
  await page.getByRole("link", { name: "Pay fees" }).first().click();
  await page.getByRole("button", { name: /Pay LKR/ }).click();
  await page.waitForURL(/pay\/sandbox/);
  await page.getByRole("button", { name: /^Pay LKR/ }).click();
  await page.waitForURL(/pay\/result/);
  await expect(page.getByText("Payment successful")).toBeVisible();
  await page.getByRole("link", { name: "View receipt" }).click();
  await expect(page.getByText("Amount received")).toBeVisible();
  await open(page, "/portal");
  await expect(page.getByText("Kavindu Perera")).toBeVisible();
});

test("a session that expires mid-visit sends the user back to sign in", async ({ page }) => {
  await signIn(page, "parent");
  await expect(page.getByText("Kavindu Perera")).toBeVisible();
  // The server drops the session (cookie still present): the next API call returns 401.
  await page.evaluate(() => localStorage.removeItem("wz_mock_session"));
  // Open a page whose data isn't cached yet, so a request actually reaches the API.
  await page.getByRole("link", { name: "Pay fees" }).first().click();
  await page.waitForURL(/\/login\?next=%2Fportal%2Fchildren%2F[^&]+&expired=1/);
});
