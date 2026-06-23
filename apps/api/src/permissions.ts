// Canonical permission types for API key allowed_types.
// These are API-surface concepts, not job types — message/message_custom
// both map to the "ticket" job internally.
export const PERMISSION_TYPES = [
  "text",
  "message",         // message card; from is locked to the key name
  "message_custom",  // message card; from can be overridden in the request body
  "ticket",          // full card (badge, label, date, rows, from — all editable)
  "todo",            // checklist / shopping list card
  "qr",
  "image",
  // internal / debug (not shown in the UI but valid for backwards compat)
  "borders",
  "test",
] as const;

export type PermissionType = typeof PERMISSION_TYPES[number];

// ─── KeyPermissions ────────────────────────────────────────────────────────────
// A Service Key's allowed types as a value, not a raw JSON string. The storage
// representation (a JSON column, or null = unrestricted) and every allow-rule
// live here — callers ask questions, they don't parse. `null` allowed-set means
// the key carries no type restriction (all types permitted).
export class KeyPermissions {
  private constructor(private readonly allowed: ReadonlySet<string> | null) {}

  // From the stored DB column (raw JSON string, or null = unrestricted).
  static fromColumn(raw: string | null): KeyPermissions {
    if (raw === null) return new KeyPermissions(null);
    return new KeyPermissions(new Set(JSON.parse(raw) as string[]));
  }

  // From a parsed list (or null = unrestricted) — the shape callers send/receive.
  static fromList(list: readonly string[] | null): KeyPermissions {
    return new KeyPermissions(list === null ? null : new Set(list));
  }

  // Does this key permit enqueuing the given job/permission type?
  permits(type: string): boolean {
    return this.allowed === null || this.allowed.has(type);
  }

  // The /print/message endpoint accepts either permission.
  permitsMessage(): boolean {
    return this.permits("message") || this.permits("message_custom");
  }

  // May the caller override `from` on a message card?
  get allowsCustomFrom(): boolean {
    return this.permits("message_custom");
  }

  // The wire/JSON view (null = unrestricted).
  toList(): string[] | null {
    return this.allowed === null ? null : [...this.allowed];
  }

  // The stored-column view (null = unrestricted).
  toColumn(): string | null {
    return this.allowed === null ? null : JSON.stringify([...this.allowed]);
  }
}
