import { expect, test } from "@playwright/test";

test("CSV import surfaces empty, missing-column and invalid-row problems without writing bad data", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /Import contacts/ }).click();
  const input = page.getByTestId("csv-input");

  await input.setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") });
  await expect(page.getByText("The CSV file is empty.")).toBeVisible();

  await input.setInputFiles({ name: "wrong.exe", mimeType: "application/octet-stream", buffer: Buffer.from("a,b") });
  await expect(page.getByText("Only .csv files are supported.")).toBeVisible();

  await input.setInputFiles({ name: "cols.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Mail\nZ1,z1@example.com\n") });
  await expect(page.getByText("Map the required columns")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import 0 rows/ })).toBeDisabled();

  await input.setInputFiles({ name: "rows.csv", mimeType: "text/csv", buffer: Buffer.from("contact_id,email,first_name\nZ2,,NoEmail\nZ3,z3@example.com,Ok\n") });
  await expect(page.getByTestId("import-summary")).toContainText("Rejected");
  await expect(page.getByRole("button", { name: /Error report/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Error report/ }).click();
  expect((await download).suggestedFilename()).toBe("contacts-import-issues.csv");
});
