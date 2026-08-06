import type { Env } from "./env";
import { purgeExpiredVisits } from "./cleanup";
import { handleDashboardRequest } from "./dashboard/api";
import { handlePublicRequest } from "./public-handler";

const CLEANUP_FAILURE_CATEGORY = "visitor_retention_cleanup_failed";

function exceptionName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

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
  },

  async scheduled(controller, env): Promise<void> {
    try {
      await purgeExpiredVisits(env.DB, new Date(controller.scheduledTime));
    } catch (error) {
      console.error(CLEANUP_FAILURE_CATEGORY, exceptionName(error));
      throw error;
    }
  }
} satisfies ExportedHandler<Env>;
