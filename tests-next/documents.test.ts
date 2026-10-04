import { it, expect } from "vitest";
import {
  parseExpensas,
  validatePdf,
  MAX_PDF_BYTES,
} from "../src/lib/documents";
it("recognizes both reading orders and chooses the first due date", () => {
  for (const text of [
    "1er.Vencim.: 14 - 09 - 2026 $ 10500.20\nEXPENSAS GENERALES 10000.20\nEXPENSAS EXTRAORDINARIAS 500.00",
    "14 - 09 - 2026 $ 10500.20\t1er.Vencim.:\n10000.20EXPENSAS GENERALES\n500.00EXPENSAS EXTRAORDINARIAS\n2do.Vencim.: 21-09-2026 $ 11000.20",
  ]) {
    const result = parseExpensas(text)!;
    expect(result.dueDate).toBe("2026-09-14");
    expect(result.amountCents).toBe(1050020n);
    expect(result.extraordinaryCents).toBe(50000n);
  }
});
it("does not invent extraordinary expenses or accept unrelated text", () => {
  expect(parseExpensas("Receipt: 1er.Vencim.: 14/09/2026 $ 999")).toBeNull();
  expect(
    parseExpensas(
      "EXPENSAS GENERALES 1200.00\n1er.Vencim.: 14/09/2026 $ 1200.00",
    )?.extraordinaryCents,
  ).toBe(0n);
  expect(
    parseExpensas("EXPENSAS GENERALES\n1er.Vencim.: 30/02/2026 $ 1200.00"),
  ).toBeNull();
});
it("rejects invalid files and enforces the size limit", () => {
  expect(() => validatePdf(Buffer.from("<html>not pdf</html>"))).toThrow();
  const large = Buffer.alloc(MAX_PDF_BYTES + 1);
  large.write("%PDF-");
  expect(() => validatePdf(large)).toThrow();
});
