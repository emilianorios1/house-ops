import { describe, it, expect } from "vitest";
import { calculateMonth } from "../src/lib/calculation";
import { cents, dateSchema, shiftMonth } from "../src/lib/money";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { pbkdf2Sync, scryptSync } from "node:crypto";
describe("monthly sharing", () => {
  it("credits the prior due month, not the statement period or current month's expenses", () => {
    const current = [
      {
        id: "bill",
        amountCents: 10000n,
        extraordinaryCents: 1000n,
        payments: [],
      },
    ];
    const result = calculateMonth(
      current,
      [{ extraordinaryCents: 4700000n }],
      { grossCents: 70000000n, creditOverrideCents: null, payments: [] },
      [],
    );
    expect(result.net).toBe(65300000n);
    expect(result.total).toBe(65310000n);
    expect(result.paid).toBe(0n);
    expect(result.reimbursement).toBe(0n);
  });
  it("has no credit without extraordinary expenses", () =>
    expect(
      calculateMonth(
        [],
        [],
        { grossCents: 70000000n, creditOverrideCents: null, payments: [] },
        [],
      ).net,
    ).toBe(70000000n));
  it("never treats an obligation as an advance and settles only actual payments", () => {
    const bills = [
      {
        id: "b",
        amountCents: 20000n,
        extraordinaryCents: 0n,
        payments: [{ payer: "emiliano", amountCents: 10000n, voided: false }],
      },
    ];
    const s = calculateMonth(bills, [], null, []);
    expect(s.pending).toBe(10000n);
    expect(s.reimbursement).toBe(5000n);
    expect(
      calculateMonth(bills, [], null, [
        { from: "vitoria", amountCents: 5000n, voided: false },
      ]).reimbursement,
    ).toBe(0n);
  });
  it("ignores voided payments and settlements", () => {
    const s = calculateMonth(
      [
        {
          id: "b",
          amountCents: 99n,
          extraordinaryCents: 0n,
          payments: [{ payer: "emiliano", amountCents: 99n, voided: true }],
        },
      ],
      [],
      null,
      [{ from: "vitoria", amountCents: 99n, voided: true }],
    );
    expect(s.paid).toBe(0n);
    expect(s.reimbursement).toBe(0n);
    expect(s.emilianoShare + s.vitoriaShare).toBe(99n);
  });
  it("makes rounding deterministic without losing a cent", () => {
    const s = calculateMonth(
      [
        {
          id: "b",
          amountCents: 101n,
          extraordinaryCents: 0n,
          payments: [{ payer: "emiliano", amountCents: 101n, voided: false }],
        },
      ],
      [],
      null,
      [],
    );
    expect(s.emilianoShare).toBe(51n);
    expect(s.vitoriaShare).toBe(50n);
    expect(s.reimbursement).toBe(50n);
  });
  it("preserves an explicit zero override and flags unused credit", () => {
    expect(
      calculateMonth(
        [],
        [{ extraordinaryCents: 100n }],
        { grossCents: 50n, creditOverrideCents: 0n, payments: [] },
        [],
      ).net,
    ).toBe(50n);
    const s = calculateMonth(
      [],
      [{ extraordinaryCents: 100n }],
      { grossCents: 50n, creditOverrideCents: null, payments: [] },
      [],
    );
    expect(s.net).toBe(0n);
    expect(s.unusedCredit).toBe(50n);
  });
});
it("validates exact cents and calendar dates", () => {
  expect(cents("700000.50")).toBe(70000050n);
  for (const invalid of ["-1", "1,50", "1.001", "1e5", "Infinity"])
    expect(() => cents(invalid)).toThrow();
  expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
});
it("preserves Django passwords and hashes new passwords", () => {
  const hash = hashPassword("a-long-password");
  expect(verifyPassword("a-long-password", hash)).toBe(true);
  expect(verifyPassword("wrong", hash)).toBe(false);
  const digest = pbkdf2Sync(
    "old-password",
    "synthetic-salt",
    1000,
    32,
    "sha256",
  ).toString("base64");
  expect(
    verifyPassword(
      "old-password",
      `pbkdf2_sha256$1000$synthetic-salt$${digest}`,
    ),
  ).toBe(true);
  expect(verifyPassword("anything", "bad")).toBe(false);
  const legacyScrypt = scryptSync("old-password", "synthetic-salt", 64, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString("base64");
  expect(
    verifyPassword(
      "old-password",
      `scrypt$16384$synthetic-salt$8$1$${legacyScrypt}`,
    ),
  ).toBe(true);
});
