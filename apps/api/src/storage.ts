// Optional archival of printed images to Cloudflare R2 (S3-compatible).
// Enabled only when the R2_* env vars are set — so prod stores, dev does nothing.
// Uploads are fire-and-forget: a storage failure never blocks or fails a print.
import { S3Client } from "bun";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL, // public base (r2.dev or custom domain); used to build view links
} = process.env;

// Configured only when every required var is present (prod). Otherwise null (dev).
const client =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
    ? new S3Client({
        accessKeyId:     R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
        bucket:          R2_BUCKET,
        endpoint:        `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      })
    : null;

export function storageEnabled(): boolean {
  return client !== null;
}

function extFor(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  if (mediaType.includes("gif")) return "gif";
  return "png";
}

// Archive a base64 image. Returns a public URL when R2_PUBLIC_URL is set, else
// the object key; null if storage is off or the upload failed. Never throws.
export async function archiveImage(
  base64: string,
  mediaType: string,
  source: string,
): Promise<string | null> {
  if (!client) return null;
  try {
    const now  = new Date();
    const day  = now.toISOString().slice(0, 10);                 // YYYY-MM-DD
    const safe = source.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const key  = `images/${day}/${safe}/${now.getTime()}-${crypto.randomUUID().slice(0, 8)}.${extFor(mediaType)}`;
    await client.write(key, Buffer.from(base64, "base64"), { type: mediaType });
    return R2_PUBLIC_URL ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key}` : key;
  } catch (e) {
    console.error("[storage] R2 upload failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
