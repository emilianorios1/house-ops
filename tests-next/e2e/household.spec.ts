import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { syntheticPdf } from "../helpers";
config({ path: ".env.local", quiet: true });
test("private pages and PDFs require a household session", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  expect((await request.get("/api/export")).status()).toBe(401);
  expect((await request.get("/api/documents/nonexistent")).status()).toBe(401);
});
test("upload, next-month rent credit, supplier payment, transfer, audit and mobile layout", async ({
  page,
}, info) => {
  const year = info.project.name === "mobile" ? "2098" : "2097";
  const month = `${year}-05`;
  const title = `Prueba ${info.project.name} ${Date.now()}`;
  await page.goto("/login");
  await page
    .getByLabel("Contraseña")
    .fill(process.env.HOUSE_OPS_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Entrar a casa" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/expenses/new?month=${month}`);
  const pdf = syntheticPdf([
    "EXPENSAS GENERALES 1150.00",
    "EXPENSAS EXTRAORDINARIAS 50.00",
    `1er.Vencim.: 14/04/${year} $ 1200.00`,
  ]);
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: `synthetic-${Date.now()}.pdf`,
      mimeType: "application/pdf",
      buffer: pdf,
    });
  await expect(
    page.getByText("Leímos la liquidación.", { exact: false }),
  ).toBeVisible();
  const documentId = await page
    .locator('input[name="documentId"]')
    .inputValue();
  const original = await page.request.get(`/api/documents/${documentId}`);
  expect(original.status()).toBe(200);
  expect((await original.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByLabel("Nombre del gasto").fill(title);
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page).toHaveURL(new RegExp(`month=${year}-04`));
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByLabel("Importe pagado ($)", { exact: true }).fill("1200.01");
  await page
    .getByRole("button", { name: "Registrar pago", exact: true })
    .click();
  await expect(
    page.getByText("El pago supera lo que queda pendiente."),
  ).toBeVisible();
  await page.getByLabel("Importe pagado ($)", { exact: true }).fill("1200.00");
  await page
    .getByRole("button", { name: "Registrar pago", exact: true })
    .click();
  await expect(page).toHaveURL(/saved=1/);
  await page.getByRole("link", { name: "Registrar transferencia" }).click();
  await page
    .getByRole("button", { name: "Registrar transferencia", exact: true })
    .click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(page.getByText("Estamos a mano por lo pagado")).toBeVisible();
  await page.goto(`/rent/${month}`);
  await page
    .getByLabel("Alquiler acordado, antes del descuento ($)")
    .fill("1000");
  await page.getByRole("button", { name: "Guardar alquiler" }).click();
  await expect(page).toHaveURL(new RegExp(`month=${month}`));
  await expect(page.getByText("$ 950", { exact: true }).first()).toBeVisible();
  await page.goto(`/expenses/new?month=${month}`);
  await page.getByLabel("Nombre del gasto").fill(title + " luz");
  await page.getByLabel("Categoría").selectOption("Luz");
  await page.getByLabel("Importe total ($)").fill("100.01");
  await page.getByLabel("Vencimiento").fill(`${month}-20`);
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page.getByText("$ 1.050,01", { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.private/previews/${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/documents");
  await expect(
    page.getByRole("heading", { name: "Comprobantes", exact: true }),
  ).toBeVisible();
  await page.goto("/audit");
  await expect(
    page.getByText("emiliano registró un pago").first(),
  ).toBeVisible();
  await expect(
    page.getByText("emiliano registró una transferencia").first(),
  ).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Nuestras cuentas, mes a mes" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
