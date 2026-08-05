interface VisitorLoggingEnv {
  DB: D1Database;
  PUBLIC_HOSTS: string;
  ADMIN_HOST: string;
  ADMIN_EMAIL: string;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
}

export interface Env extends VisitorLoggingEnv {}

declare global {
  namespace Cloudflare {
    interface Env extends VisitorLoggingEnv {}
  }
}
