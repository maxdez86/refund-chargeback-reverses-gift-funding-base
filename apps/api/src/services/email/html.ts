export function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailDocument(
  content: string,
  options?: {
    preheader?: string;
  }
) {
  return (
    "<!doctype html>" +
    '<html lang="pt-BR">' +
    "<body style=\"margin:0;padding:24px;font-family:Arial,sans-serif;color:#1f2937;background-color:#f7f4ee;\">" +
    `${options?.preheader ? renderEmailPreheader(options.preheader) : ""}` +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">' +
    `<tr><td style="padding:32px 24px;line-height:1.6;">${content}</td></tr>` +
    "</table>" +
    "</td></tr>" +
    "</table>" +
    "</body>" +
    "</html>"
  );
}

export function renderEmailPreheader(value: string) {
  const escaped = escapeHtml(value);

  return (
    `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">${escaped}</div>` +
    '<div style="display:none;max-height:0;overflow:hidden;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>'
  );
}

export function renderEmailSection(content: string) {
  return `<div style="margin:0 0 24px;">${content}</div>`;
}

export function renderEmailCard(content: string) {
  return (
    '<div style="margin:0 0 24px;padding:20px;border:1px solid #e5e7eb;border-radius:16px;background-color:#fcfaf7;">' +
    content +
    "</div>"
  );
}

export function renderEmailImage(input: {
  alt: string;
  src: string;
  width?: number;
}) {
  const width = input.width ?? 240;

  return (
    '<div style="margin:0 0 24px;text-align:center;">' +
    `<img src="${escapeHtml(input.src)}" alt="${escapeHtml(input.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;margin:0 auto;border:0;border-radius:16px;background-color:#f7f4ee;" />` +
    "</div>"
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
