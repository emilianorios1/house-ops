import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  pbkdf2Sync,
} from "node:crypto";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  try {
    const parts = hash.split("$");
    const [algorithm, salt, digest, encoded] = hash.split("$");
    if (algorithm === "scrypt") {
      if (parts.length === 6) {
        const [, workFactor, djangoSalt, blockSize, parallelism, hashValue] =
          parts;
        const N = Number(workFactor),
          r = Number(blockSize),
          p = Number(parallelism);
        if (
          !Number.isInteger(N) ||
          N < 1024 ||
          N > 262144 ||
          (N & (N - 1)) !== 0 ||
          !Number.isInteger(r) ||
          r < 1 ||
          r > 32 ||
          !Number.isInteger(p) ||
          p < 1 ||
          p > 8
        )
          return false;
        const actual = scryptSync(password, djangoSalt, 64, {
          N,
          r,
          p,
          maxmem: Math.max(32 * 1024 * 1024, 128 * N * r * 2),
        });
        const expected = Buffer.from(hashValue, "base64");
        return (
          actual.length === expected.length && timingSafeEqual(actual, expected)
        );
      }
      if (parts.length !== 3) return false;
      const actual = scryptSync(password, salt, 64);
      const expected = Buffer.from(digest, "hex");
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    }
    // Preserve existing Django credentials during the one-time migration.
    if (algorithm === "pbkdf2_sha256") {
      const rounds = Number(salt);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5000000)
        return false;
      const actual = pbkdf2Sync(password, digest, rounds, 32, "sha256");
      const expected = Buffer.from(encoded, "base64");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    }
    return false;
  } catch {
    return false;
  }
}
export function supportsPasswordHash(hash: string) {
  if (/^pbkdf2_sha256\$[0-9]+\$[^$]+\$[A-Za-z0-9+/=]+$/.test(hash)) {
    const rounds = Number(hash.split("$")[1]);
    return rounds >= 1 && rounds <= 5000000;
  }
  if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) return true;
  if (/^scrypt\$[0-9]+\$[^$]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+$/.test(hash)) {
    const [, n, , r, p] = hash.split("$");
    const N = Number(n);
    return (
      Number.isInteger(N) &&
      N >= 1024 &&
      N <= 262144 &&
      (N & (N - 1)) === 0 &&
      Number(r) >= 1 &&
      Number(r) <= 32 &&
      Number(p) >= 1 &&
      Number(p) <= 8
    );
  }
  return false;
}
