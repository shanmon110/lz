const WORDPRESS_PATH_PATTERN = /^\/wp(?:-|\/)/i;
const PHP_PATH_PATTERN = /(?:^|\/)\.?.+\.php(?:\/|$)/i;
const SECRET_PATH_PATTERN = /^\/(?:\.env(?:\.|$)|\.git(?:\/|$))/i;
const ROBOTS_PATH_PATTERN = /^\/robots\.txt$/i;

export function isScannerPath(path: string): boolean {
  return WORDPRESS_PATH_PATTERN.test(path) ||
    PHP_PATH_PATTERN.test(path) ||
    SECRET_PATH_PATTERN.test(path) ||
    ROBOTS_PATH_PATTERN.test(path);
}
