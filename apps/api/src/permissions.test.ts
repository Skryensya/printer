import { test, expect, describe } from "bun:test";
import { KeyPermissions } from "./permissions";

// The deep value is the test surface: pure, no DB. Every allow-rule lives here,
// so it can be exercised through the interface without a key or a request.

describe("KeyPermissions", () => {
  test("null column = unrestricted: permits anything", () => {
    const p = KeyPermissions.fromColumn(null);
    expect(p.permits("text")).toBe(true);
    expect(p.permits("anything")).toBe(true);
    expect(p.permitsMessage()).toBe(true);
    expect(p.allowsCustomFrom).toBe(true);
    expect(p.toList()).toBeNull();
  });

  test("restricted column permits only listed types", () => {
    const p = KeyPermissions.fromColumn(JSON.stringify(["text", "qr"]));
    expect(p.permits("text")).toBe(true);
    expect(p.permits("qr")).toBe(true);
    expect(p.permits("image")).toBe(false);
    expect(p.toList()).toEqual(["text", "qr"]);
  });

  test("permitsMessage accepts message OR message_custom", () => {
    expect(KeyPermissions.fromList(["message"]).permitsMessage()).toBe(true);
    expect(KeyPermissions.fromList(["message_custom"]).permitsMessage()).toBe(true);
    expect(KeyPermissions.fromList(["text"]).permitsMessage()).toBe(false);
  });

  test("allowsCustomFrom only when message_custom is held", () => {
    expect(KeyPermissions.fromList(["message"]).allowsCustomFrom).toBe(false);
    expect(KeyPermissions.fromList(["message_custom"]).allowsCustomFrom).toBe(true);
  });

  test("fromColumn/toColumn round-trips through storage", () => {
    expect(KeyPermissions.fromList(null).toColumn()).toBeNull();
    expect(KeyPermissions.fromColumn(KeyPermissions.fromList(["text"]).toColumn()).permits("text")).toBe(true);
  });
});
