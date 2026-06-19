export function healthHandler(_req: Request): Response {
  return Response.json({ ok: true, service: "printer-api" });
}
