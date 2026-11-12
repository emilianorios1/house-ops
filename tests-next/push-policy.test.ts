import { describe, expect, it } from "vitest";
import {
  argentinaClock,
  retryAt,
  subscriptionSchema,
  trustedPushEndpoint,
} from "../src/lib/push-policy";
describe("push policy", () => {
  it("uses Argentina dates across UTC midnight and year boundaries", () => {
    expect(argentinaClock(new Date("2027-01-01T01:00:00Z"))).toMatchObject({
      date: "2026-12-31",
      tomorrow: "2027-01-01",
      hour: 22,
    });
    expect(argentinaClock(new Date("2027-01-01T12:00:00Z"))).toMatchObject({
      date: "2027-01-01",
      hour: 9,
    });
    expect(
      argentinaClock(new Date("2027-01-01T12:00:00Z")).expiresAt.toISOString(),
    ).toBe("2027-01-01T15:00:00.000Z");
  });
  it("rejects private, deceptive and non-HTTPS destinations", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/push",
      "https://127.0.0.1/push",
      "https://localhost/push",
      "https://web.push.apple.com.evil.test/push",
      "https://evil.test/?host=fcm.googleapis.com",
      "https://fcm.googleapis.com@evil.test/push",
      "https://fcm.googleapis.com:9443/push",
    ])
      expect(trustedPushEndpoint(endpoint)).toBe(false);
    expect(
      trustedPushEndpoint("https://fcm.googleapis.com/fcm/send/example"),
    ).toBe(true);
    expect(trustedPushEndpoint("https://web.push.apple.com/example")).toBe(
      true,
    );
    expect(
      subscriptionSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/example",
        keys: { p256dh: "bad", auth: "bad" },
      }).success,
    ).toBe(false);
  });
  it("backs off transient failures with an upper bound", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(retryAt(1, now).getTime() - now.getTime()).toBe(120000);
    expect(retryAt(100, now).getTime() - now.getTime()).toBe(3600000);
  });
});
