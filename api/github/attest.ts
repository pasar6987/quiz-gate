import { serverEnv } from "../../src/server/env.js";
import { errorResponse, json } from "../../src/server/http.js";
import { attestFromGitHubActions } from "../../src/server/oidc.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Missing OIDC bearer token" }, { status: 401 });
    }
    const raw = await request.text();
    if (raw.length > 16_384) {
      return json({ ok: false, error: "Attestation body is too large" }, { status: 413 });
    }
    const result = await attestFromGitHubActions({
      env: serverEnv(),
      oidcToken: authorization.slice("Bearer ".length),
      body: JSON.parse(raw) as unknown,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
