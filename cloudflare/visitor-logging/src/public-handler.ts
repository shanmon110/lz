import type { Env } from "./env";
import { isDocumentVisit } from "./visits/classify";
import { buildVisit } from "./visits/normalize";
import { insertVisit } from "./visits/repository";

type OriginFetch = (request: Request) => Promise<Response>;

function reportOperationalError(error: unknown): void {
  const exceptionName = error instanceof Error ? error.name : "UnknownError";
  console.error("visitor_log_write_failed", exceptionName);
}

export async function handlePublicRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  fetchOrigin: OriginFetch = fetch
): Promise<Response> {
  const originResponsePromise = fetchOrigin(request);

  if (isDocumentVisit(request)) {
    const visitWrite = insertVisit(env.DB, buildVisit(request, new Date()))
      .catch(reportOperationalError);
    ctx.waitUntil(visitWrite);
  }

  return originResponsePromise;
}
