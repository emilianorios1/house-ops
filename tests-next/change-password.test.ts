import { expect, test } from "vitest";
import { validatePasswordChange } from "../scripts/change-password";

test("administrative reset accepts only household users and bounded passwords", () => {
  for (const username of ["vitoria", "emiliano"]) {
    expect(() =>
      validatePasswordChange(username, "x".repeat(9)),
    ).not.toThrow();
    expect(() =>
      validatePasswordChange(username, "x".repeat(128)),
    ).not.toThrow();
    for (const password of [
      "",
      "x".repeat(8),
      "x".repeat(129),
      "long-password\n",
      "long-password\0",
    ])
      expect(() => validatePasswordChange(username, password)).toThrow();
  }
  expect(() => validatePasswordChange("other", "valid-password")).toThrow();
});
