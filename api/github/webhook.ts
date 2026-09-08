import { waitUntil } from "@vercel/functions";
import { serverEnv } from "../../src/server/env.js";
import { errorResponse, json } from "../../src/server/http.js";
import { verifyWebhookSignature } from "../../src/server/signature.js";
import { handleWebhook } from "../../src/server/webhook.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const env = serverEnv();
    const body = await request.text();
    if (
      !verifyWebhookSignature(
        body,
        request.headers.get("x-hub-signature-256"),
        env.webhookSecret,
      )
    ) {
      return json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
    }
    const eventName = request.headers.get("x-github-event");
    if (!eventName) {
      return json({ ok: false, error: "Missing x-github-event" }, { status: 400 });
    }
    const payload = JSON.parse(body) as unknown;
    const work = handleWebhook({ env, eventName, payload }).catch((error: unknown) => {
      console.error(`Quiz Gate ${eventName} webhook failed:`, error);
    });
    waitUntil(work);
    return json({ ok: true, accepted: eventName }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
