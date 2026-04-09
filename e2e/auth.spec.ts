import { test, expect } from "@playwright/test";

test.describe("Auth Flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // unauthenticated

  test("shows auth page for unauthenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/auth");
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByPlaceholder("Email address")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
  });

  test("sign in / sign up tab toggle works", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();

    // Toggle to sign up
    await page.getByRole("button", { name: "Create Account" }).click();
    // Submit button text should change
    const submitBtn = page.locator("button[type='submit']");
    await expect(submitBtn).toContainText("Create Account");

    // Toggle back to sign in
    await page.getByRole("button", { name: "Sign In" }).first().click();
    await expect(submitBtn).toContainText("Sign In");
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/auth");
    await page.getByPlaceholder("Email address").fill("nonexistent@test.com");
    await page.getByPlaceholder("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should show error message, not redirect
    await expect(page.locator(".text-signal-dn")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth/);
  });

  test("forgot password shows coming soon toast", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText("Password reset coming soon")).toBeVisible();
  });

  test("Google SSO button is present", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  });
});
