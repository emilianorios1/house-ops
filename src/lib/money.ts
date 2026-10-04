import { z } from "zod";
export function cents(value: string): bigint {
  const v = value.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v))
    throw new Error(
      "Usá un importe positivo, con hasta dos decimales (ejemplo: 700000 o 700000.50).",
    );
  const [whole, fraction = ""] = v.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimal(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function money(value: bigint) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value) / 100);
}
export const amountSchema = z.string().transform((value, ctx) => {
  try {
    return cents(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message:
        "Revisá el importe: hasta dos decimales, sin separador de miles.",
    });
    return z.NEVER;
  }
});
export const monthSchema = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Elegí un mes válido.");
export const dateSchema = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Elegí una fecha válida.");
export function shiftMonth(month: string, shift: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + shift, 1)).toISOString().slice(0, 7);
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
export function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}
export function utcDate(value: string) {
  return new Date(`${dateSchema.parse(value)}T00:00:00Z`);
}
export const categories = [
  "Expensas",
  "Luz",
  "Agua",
  "Gas",
  "TGI",
  "Otros",
] as const;
export const people = ["emiliano", "vitoria"] as const;
