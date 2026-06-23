export function buildAppUrl(path) {
  const normalizedBase = import.meta.env.BASE_URL || "/";
  const base = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
}

export function hardNavigate(path) {
  window.location.assign(buildAppUrl(path));
}

export function openInNewPage(path) {
  const nextUrl = buildAppUrl(path);
  const newWindow = window.open(nextUrl, "_blank", "noopener");
  if (!newWindow) {
    window.location.assign(nextUrl);
  }
}
