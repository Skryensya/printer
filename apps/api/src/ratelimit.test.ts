import { describe, test, expect, beforeEach, jest } from "bun:test";
import { resetDbForTest, createApiKey } from "./db";
import { checkQuota, resetMinuteWindows } from "./ratelimit";

beforeEach(async () => {
  await resetDbForTest();
  resetMinuteWindows();
  jest.useRealTimers();
});

describe("checkQuota — unlimited key", () => {
  test("always allows when quota is null", async () => {
    const { key } = await createApiKey("svc");
    const result = await checkQuota(key);
    expect(result.allowed).toBe(true);
    expect(result.exceeded).toBeNull();
  });

  test("no limit headers when quota is null", async () => {
    const { key } = await createApiKey("svc");
    const h = (await checkQuota(key)).headers();
    expect(h["X-RateLimit-Limit-Minute"]).toBeUndefined();
    expect(h["X-RateLimit-Limit-Day"]).toBeUndefined();
    expect(h["X-RateLimit-Remaining-Minute"]).toBeUndefined();
    expect(h["X-RateLimit-Remaining-Day"]).toBeUndefined();
  });
});

describe("checkQuota — minute limit", () => {
  test("allows up to the per-minute limit", async () => {
    const { key } = await createApiKey("svc", undefined, 3, null);
    expect((await checkQuota(key)).allowed).toBe(true);
    expect((await checkQuota(key)).allowed).toBe(true);
    expect((await checkQuota(key)).allowed).toBe(true);
    const blocked = await checkQuota(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.exceeded).toBe("minute");
    expect(blocked.headers()["X-RateLimit-Remaining-Minute"]).toBe("0");
  });

  test("decrements Remaining-Minute header on each allowed request", async () => {
    const { key } = await createApiKey("svc", undefined, 3, null);
    expect((await checkQuota(key)).headers()["X-RateLimit-Remaining-Minute"]).toBe("2");
    expect((await checkQuota(key)).headers()["X-RateLimit-Remaining-Minute"]).toBe("1");
    expect((await checkQuota(key)).headers()["X-RateLimit-Remaining-Minute"]).toBe("0");
  });

  test("sliding window: old requests fall off after 60s", async () => {
    jest.useFakeTimers();
    const start = 1_750_000_000_000;
    jest.setSystemTime(start);

    const { key } = await createApiKey("svc", undefined, 2, null);
    await checkQuota(key);
    await checkQuota(key);
    expect((await checkQuota(key)).allowed).toBe(false);

    jest.setSystemTime(start + 61_000);
    expect((await checkQuota(key)).allowed).toBe(true);
  });

  test("retryAfter is seconds until oldest request falls off", async () => {
    jest.useFakeTimers();
    const start = 1_750_000_000_000;
    jest.setSystemTime(start);

    const { key } = await createApiKey("svc", undefined, 1, null);
    await checkQuota(key); // consume at T=0

    jest.setSystemTime(start + 10_000); // advance 10s
    const blocked = await checkQuota(key);
    expect(blocked.retryAfter).toBe(50); // 60 - 10 = 50s remaining
  });
});

describe("checkQuota — day limit", () => {
  test("allows up to the per-day limit", async () => {
    const { key } = await createApiKey("svc", undefined, null, 2);
    expect((await checkQuota(key)).allowed).toBe(true);
    expect((await checkQuota(key)).allowed).toBe(true);
    const blocked = await checkQuota(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.exceeded).toBe("day");
    expect(blocked.headers()["X-RateLimit-Remaining-Day"]).toBe("0");
  });

  test("day window resets at UTC midnight", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-19T23:59:59Z").getTime());

    const { key } = await createApiKey("svc", undefined, null, 1);
    await checkQuota(key);
    expect((await checkQuota(key)).allowed).toBe(false);

    jest.setSystemTime(new Date("2026-06-20T00:00:01Z").getTime());
    expect((await checkQuota(key)).allowed).toBe(true);
  });

  test("retryAfter for day limit is seconds until next midnight UTC", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-19T23:00:00Z").getTime()); // 1 hour before midnight

    const { key } = await createApiKey("svc", undefined, null, 1);
    await checkQuota(key);
    const blocked = await checkQuota(key);
    expect(blocked.retryAfter).toBe(3600); // 1 hour = 3600 seconds
  });
});

describe("checkQuota — both limits", () => {
  test("minute limit is checked before day limit", async () => {
    const { key } = await createApiKey("svc", undefined, 1, 10);
    await checkQuota(key);
    const blocked = await checkQuota(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.exceeded).toBe("minute");
  });

  test("minute-blocked request does not consume daily quota", async () => {
    jest.useFakeTimers();
    const start = 1_750_000_000_000;
    jest.setSystemTime(start);

    const { key } = await createApiKey("svc", undefined, 1, 2);
    await checkQuota(key);           // allowed — daily count = 1
    await checkQuota(key);           // blocked by minute — daily count stays 1
    await checkQuota(key);           // blocked by minute — daily count stays 1

    jest.setSystemTime(start + 61_000); // minute window clears
    const result = await checkQuota(key);     // allowed — daily count = 2
    expect(result.allowed).toBe(true);
    expect(result.headers()["X-RateLimit-Remaining-Day"]).toBe("0");
  });

  test("day-blocked response still includes minute headers", async () => {
    const { key } = await createApiKey("svc", undefined, 10, 1);
    await checkQuota(key); // consume the day quota
    const blocked = await checkQuota(key);
    expect(blocked.exceeded).toBe("day");
    expect(blocked.headers()["X-RateLimit-Limit-Minute"]).toBe("10");
    expect(blocked.headers()["X-RateLimit-Remaining-Minute"]).toBe("9"); // 1 request used
  });

  test("attachHeaders copies all rate-limit headers onto the response", async () => {
    const { key } = await createApiKey("svc", undefined, 5, null);
    const quota = await checkQuota(key);
    const wrapped = quota.attachHeaders(new Response("ok", { status: 200 }));
    expect(wrapped.headers.get("X-RateLimit-Limit-Minute")).toBe("5");
    expect(wrapped.headers.get("X-RateLimit-Remaining-Minute")).toBe("4");
    expect(wrapped.status).toBe(200);
  });
});
