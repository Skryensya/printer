import { describe, test, expect, beforeEach } from "bun:test";
import {
  loginLockRemaining, recordLoginFailure, recordLoginSuccess, resetLoginThrottle,
} from "./wall-login-throttle";

beforeEach(() => resetLoginThrottle());

describe("wall login throttle", () => {
  test("no lock before the threshold", () => {
    for (let i = 0; i < 4; i++) recordLoginFailure("ana");
    expect(loginLockRemaining("ana")).toBe(0);
  });

  test("locks after 5 failures", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("ana");
    expect(loginLockRemaining("ana")).toBeGreaterThan(0);
  });

  test("lock is per-username", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("ana");
    expect(loginLockRemaining("ben")).toBe(0);
  });

  test("success clears accumulated failures", () => {
    for (let i = 0; i < 4; i++) recordLoginFailure("ana");
    recordLoginSuccess("ana");
    for (let i = 0; i < 4; i++) recordLoginFailure("ana");
    expect(loginLockRemaining("ana")).toBe(0); // counter was reset, still under threshold
  });

  test("lock expires after its window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordLoginFailure("ana", now);
    expect(loginLockRemaining("ana", now)).toBeGreaterThan(0);
    expect(loginLockRemaining("ana", now + 16 * 60_000)).toBe(0);
  });
});
