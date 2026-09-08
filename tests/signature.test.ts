import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../src/server/signature.js";

describe("GitHub webhook signatures", () => {
  it("accepts only the matching HMAC", () => {
    const body = '{"zen":"Keep it logically awesome."}';
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyWebhookSignature(`${body}x`, signature, "secret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "secret")).toBe(false);
  });
});
