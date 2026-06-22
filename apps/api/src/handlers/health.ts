export function healthHandler(_req: Request): Response {
  return Response.json({ service: "printer-api" });
}
