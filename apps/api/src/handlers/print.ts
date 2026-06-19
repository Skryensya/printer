import { enqueue } from "../queue";
import type {
  PrintTextBody, PrintTicketBody, PrintQrBody,
  PrintBarcodeBody, PrintImageBody,
} from "../types";

function err(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try { return await req.json() as T; }
  catch { return null; }
}

export async function printTextHandler(req: Request, source: string): Promise<Response> {
  const body = await parseJson<PrintTextBody>(req);
  if (!body?.text) return err("body.text is required");

  const job = enqueue("text", {
    text:   body.text,
    align:  body.align ?? "left",
    bold:   body.bold ?? false,
    size:   Math.min(8, Math.max(1, body.size ?? 1)),
    invert: body.invert ?? false,
  }, source);

  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printTicketHandler(req: Request, source: string): Promise<Response> {
  const body = await parseJson<PrintTicketBody>(req);
  if (!body?.id || !body?.title || !body?.priority || !body?.status) {
    return err("body.id, title, priority, and status are required");
  }

  const job = enqueue("ticket", {
    id:       body.id,
    title:    body.title,
    priority: body.priority,
    status:   body.status,
    assignee: body.assignee,
    due:      body.due,
    tags:     body.tags,
    style:    body.style ?? "thin",
  }, source);

  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printQrHandler(req: Request, source: string): Promise<Response> {
  const body = await parseJson<PrintQrBody>(req);
  if (!body?.text) return err("body.text is required");

  const job = enqueue("qr", {
    text:       body.text,
    size:       Math.min(16, Math.max(1, body.size ?? 8)),
    errorLevel: body.errorLevel ?? "M",
  }, source);

  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printBarcodeHandler(req: Request, source: string): Promise<Response> {
  const body = await parseJson<PrintBarcodeBody>(req);
  if (!body?.data) return err("body.data is required");

  const job = enqueue("barcode", {
    data:   body.data,
    height: Math.min(255, Math.max(1, body.height ?? 80)),
  }, source);

  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printImageHandler(req: Request, source: string): Promise<Response> {
  const body = await parseJson<PrintImageBody>(req);
  if (!body?.image) return err("body.image (base64) is required");

  // validate base64 early
  try { Buffer.from(body.image, "base64"); }
  catch { return err("body.image must be valid base64"); }

  const job = enqueue("image", {
    image:     body.image,
    mediaType: body.mediaType,
  }, source);

  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printBordersHandler(_req: Request, source: string): Promise<Response> {
  const job = enqueue("borders", {}, source);
  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}

export async function printTestHandler(_req: Request, source: string): Promise<Response> {
  const job = enqueue("test", {}, source);
  return Response.json({ ok: true, jobId: job.id }, { status: 202 });
}
