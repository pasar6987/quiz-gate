export function json(
  value: unknown,
  init: ResponseInit & { status?: number } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(error);
  return json({ ok: false, error: message }, { status: 500 });
}
