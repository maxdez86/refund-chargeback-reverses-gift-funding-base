export function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailDocument(content: string) {
  return (
    "<!doctype html>" +
    '<html lang="pt-BR">' +
    "<body style=\"margin:0;padding:24px;font-family:Arial,sans-serif;color:#1f2937;background-color:#ffffff;\">" +
    `<div style="max-width:640px;margin:0 auto;line-height:1.6;">${content}</div>` +
    "</body>" +
    "</html>"
  );
}

export function renderDetailLine(label: string, value: string) {
  return (
    '<p style="margin:0 0 8px;">' +
    `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}` +
    "</p>"
  );
}

export function renderMultilineText(value: string) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}
