import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { provisionPush } from "../scripts/provision-push.mjs";
test("push provisioning creates private keys once and preserves existing bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "casa-push-fixture-"));
  try {
    const file = join(directory, "vapid.env");
    expect(provisionPush(file)).toBe("created");
    const before = readFileSync(file);
    expect(provisionPush(file)).toBe("preserved");
    expect(readFileSync(file).equals(before)).toBe(true);
    writeFileSync(file, "invalid-synthetic-configuration", { mode: 0o600 });
    expect(() => provisionPush(file)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("invalid-synthetic-configuration");
  } finally {
    rmSync(directory, { recursive: true });
  }
});
