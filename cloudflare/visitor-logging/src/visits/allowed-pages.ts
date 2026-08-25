export const ALLOWED_VISIT_PATHS = [
  "/",
  "/publications",
  "/tutorials",
  "/talks",
  "/academic-service",
  "/teaching"
] as const;

export function isAllowedVisitPath(path: string): boolean {
  return ALLOWED_VISIT_PATHS.some(
    (allowedPath) =>
      path === allowedPath ||
      (allowedPath !== "/" && path === `${allowedPath}/`)
  );
}
