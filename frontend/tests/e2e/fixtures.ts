import { test as base, expect, type Page } from "@playwright/test";

export const PASSWORD = "demo1234";

/** Waits until React has hydrated the page, so typing and clicks reach event handlers. */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("form button, main button, main input, main a");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  });
}

export async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

export async function signIn(page: Page, who: "admin" | "principal" | "teacher" | "accountant" | "parent") {
  await open(page, "/login");
  await page.fill("#email", `${who}@whizchool.lk`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|portal)(\/|$)/);
}

/** Fails the test on uncaught page errors or console errors. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await use(errors);
      expect(errors, "console or page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
