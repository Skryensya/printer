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
