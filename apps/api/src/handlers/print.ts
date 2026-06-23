import {
  intakeText, intakeTicket, intakeTodo, intakeQr, intakeImage, intakeMessage, type IntakeResult,
} from "../intake";
import { enqueue } from "../queue";

async function parseJson(req: Request): Promise<unknown> {
  try { return await req.json(); }
  catch { return null; }
}

// ─── HTTP transport ────────────────────────────────────────────────────────────
// The one place a print outcome becomes bytes: 202 + Location on success, the
// domain error mapped to its status otherwise. No handler builds Responses itself.

function accepted(id: string): Response {
  return new Response(JSON.stringify({ id }), {
    status: 202,
    headers: { "Content-Type": "application/json", "Location": `/api/v1/jobs/${id}` },
  });
}

function finish(result: IntakeResult): Response {
  return result.ok
    ? accepted(result.job.id)
    : Response.json({ error: result.error }, { status: result.status });
}

// Body-carrying print routes share one shape: parse → intake → map to HTTP.
const printJson =
  (intake: (body: unknown, source: string) => Promise<IntakeResult>) =>
  async (req: Request, source: string): Promise<Response> =>
    finish(await intake(await parseJson(req), source));

export const printTextHandler   = printJson(intakeText);
export const printTicketHandler = printJson(intakeTicket);
export const printTodoHandler   = printJson(intakeTodo);
export const printQrHandler     = printJson(intakeQr);
export const printImageHandler  = printJson(intakeImage);

// Message carries an extra grant (customFromAllowed), so it keeps its own arm.
export async function printMessageHandler(
  req: Request,
  source: string,
  customFromAllowed: boolean,
): Promise<Response> {
  return finish(await intakeMessage(await parseJson(req), source, customFromAllowed));
}

// Bodyless debug prints — enqueue directly, no intake validation.
export async function printBordersHandler(_req: Request, source: string): Promise<Response> {
  return accepted((await enqueue("borders", { v: 1 }, source)).id);
}

export async function printTestHandler(_req: Request, source: string): Promise<Response> {
  return accepted((await enqueue("test", { v: 1 }, source)).id);
}
