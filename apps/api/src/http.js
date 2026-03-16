export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2) + "\n";
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

export function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.statusCode = statusCode;
  res.setHeader("content-type", contentType);
  res.end(text);
}

export function sendHtml(res, statusCode, html) {
  return sendText(res, statusCode, html, "text/html; charset=utf-8");
}

export function sendNotFound(res) {
  sendJson(res, 404, { ok: false, error: "not_found" });
}

export function sendMethodNotAllowed(res) {
  sendJson(res, 405, { ok: false, error: "method_not_allowed" });
}

export function sendInternalError(res, err) {
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { ok: false, error: "internal_error", message });
}
