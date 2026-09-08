import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePrivateKey } from "../src/server/github.js";

describe("GitHub App private keys", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("normalizes GitHub's PKCS#1 PEM to PKCS#8", () => {
    const pkcs1 = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

    expect(normalizePrivateKey(pkcs1)).toMatch(
      /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\n$/,
    );
  });

  it("accepts an existing PKCS#8 PEM", () => {
    const pkcs8 = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

    expect(normalizePrivateKey(pkcs8)).toMatch(
      /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\n$/,
    );
  });
});
