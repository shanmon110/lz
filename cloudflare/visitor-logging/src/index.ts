import type { Env } from "./env";
import { handleDashboardRequest } from "./dashboard/api";
import { handlePublicRequest } from "./public-handler";

export default {
  fetch(request, env, ctx): Response | Promise<Response> {
    const host = new URL(request.url).hostname;
    if (host === "lizhe.link" || host === "www.lizhe.link") {
      return handlePublicRequest(request, env, ctx);
    }
    if (host === env.ADMIN_HOST) {
      return handleDashboardRequest(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
