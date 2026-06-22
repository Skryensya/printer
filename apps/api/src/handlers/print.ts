import { intakeText, intakeTicket, intakeTodo, intakeImage, intakeMessage } from "../intake";
import { enqueue } from "../queue";

async function parseJson(req: Request): Promise<unknown> {
  try { return await req.json(); }
  catch { return null; }
}

function accepted(id: string): Response {
  return new Response(JSON.stringify({ id }), {
    status: 202,
    headers: { "Content-Type": "application/json", "Location": `/api/v1/jobs/${id}` },
  });
}

export async function printTextHandler(req: Request, source: string): Promise<Response> {
  const result = await intakeText(await parseJson(req), source);
  return result.ok ? accepted(result.job.id) : result.response;
}

export async function printTicketHandler(req: Request, source: string): Promise<Response> {
  const result = await intakeTicket(await parseJson(req), source);
  return result.ok ? accepted(result.job.id) : result.response;
}

export async function printTodoHandler(req: Request, source: string): Promise<Response> {
  const result = await intakeTodo(await parseJson(req), source);
  return result.ok ? accepted(result.job.id) : result.response;
}

export async function printImageHandler(req: Request, source: string): Promise<Response> {
  const result = await intakeImage(await parseJson(req), source);
  return result.ok ? accepted(result.job.id) : result.response;
}

export async function printMessageHandler(
  req: Request,
  source: string,
  customFromAllowed: boolean,
): Promise<Response> {
  const result = await intakeMessage(await parseJson(req), source, customFromAllowed);
  return result.ok ? accepted(result.job.id) : result.response;
}

export async function printBordersHandler(_req: Request, source: string): Promise<Response> {
  const job = await enqueue("borders", { v: 1 }, source);
  return accepted(job.id);
}

export async function printTestHandler(_req: Request, source: string): Promise<Response> {
  const job = await enqueue("test", { v: 1 }, source);
  return accepted(job.id);
}
