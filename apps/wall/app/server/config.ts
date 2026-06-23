// Server-only configuration. Everything here reads process.env and is only ever
// imported from inside createServerFn handlers, so none of it reaches the client
// bundle (the API key in particular must never be shipped to the browser).

const isDev = process.env["NODE_ENV"] !== "production";

export const config = {
  apiUrl:          process.env["WALL_API_URL"]          ?? "http://localhost:5801",
  apiKey:          process.env["WALL_API_KEY"]          ?? "",
  recaptchaSecret: process.env["WALL_RECAPTCHA_SECRET"] ?? "",
  // 30 minutes per IP in prod; 20 seconds in dev for fast iteration.
  cooldownMs:      Number(process.env["WALL_COOLDOWN_MS"] ?? (isDev ? 20_000 : 30 * 60 * 1000)),
  // Where the queue + cooldown ledger is persisted so a restart can't be used
  // to bypass the per-IP cooldown.
  dataDir:         process.env["WALL_DATA_DIR"]         ?? ".wall-data",
  // Minimum gap between sends to the printer API, on top of the API's own limits.
  drainIntervalMs: Number(process.env["WALL_DRAIN_INTERVAL_MS"] ?? 1500),
  // How long the local thumbnail fallback lives before being swept. It only
  // needs to outlast the R2 upload window; R2 is the permanent store. Default 1h.
  photoTtlMs:      Number(process.env["WALL_PHOTO_TTL_MS"] ?? 60 * 60 * 1000),
  maxMessageLen:   240,
  // Minimum time a human takes to fill the form. Faster => treated as a bot.
  minFillMs:       2000,
};

export function recaptchaConfigured(): boolean {
  return config.recaptchaSecret.trim().length > 0;
}
