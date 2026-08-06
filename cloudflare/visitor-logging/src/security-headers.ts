const DASHBOARD_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
} as const;

export function withDashboardSecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(DASHBOARD_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
