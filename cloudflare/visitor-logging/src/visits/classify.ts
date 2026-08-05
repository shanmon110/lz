const EXCLUDED_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp",
  "css", "js", "cjs", "mjs", "map",
  "eot", "otf", "ttf", "woff", "woff2",
  "m4a", "mp3", "mp4", "mov", "ogg", "ogv", "wav", "webm",
  "7z", "bz2", "gz", "rar", "tar", "xz", "zip",
  "csv", "doc", "docx", "ods", "odt", "pdf", "ppt", "pptx", "xls", "xlsx",
  "atom", "rss", "xml", "manifest", "webmanifest"
]);

export function isDocumentVisit(request: Request): boolean {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  const path = url.pathname;
  if (url.hostname === "logs.lizhe.link") return false;
  if (path === "/healthz" || path.startsWith("/healthz/") || path === "/cdn-cgi" || path.startsWith("/cdn-cgi/")) {
    return false;
  }
  if (path === "/service-worker" || path.startsWith("/service-worker/")) return false;

  const extension = path.split("/").pop()?.split(".").pop()?.toLowerCase();
  if (extension !== undefined && EXCLUDED_EXTENSIONS.has(extension)) return false;

  return request.headers.get("Sec-Fetch-Dest")?.toLowerCase() === "document" ||
    request.headers.get("Accept")?.toLowerCase().includes("text/html") === true;
}
