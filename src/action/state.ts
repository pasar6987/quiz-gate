import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const sealedEnvelopeSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

export const quizStateSchema = z.object({
  version: z.literal(1),
  repository_id: z.string(),
  pr_number: z.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  created_at: z.string().datetime(),
  threshold: z.number().min(0).max(100),
  answer_command: z.string(),
  questions: z
    .array(
      z.object({
        id: z.number().int().positive(),
        correct_option: z.enum(["A", "B", "C", "D"]),
      }),
    )
    .min(1)
    .max(20),
});

export type QuizState = z.infer<typeof quizStateSchema>;

function deriveStateKey(secret: string, repositoryId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from(repositoryId, "utf8"),
      Buffer.from("quiz-gate-state-v1", "utf8"),
      32,
    ),
  );
}

export function sealQuizState(state: QuizState, secret: string): string {
  const key = deriveStateKey(secret, state.repository_id);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      data: encrypted.toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");
}

export function openQuizState(
  token: string,
  secret: string,
  repositoryId: string,
): QuizState {
  const envelopeJson = Buffer.from(token, "base64url").toString("utf8");
  const envelope = sealedEnvelopeSchema.parse(JSON.parse(envelopeJson));
  const key = deriveStateKey(secret, repositoryId);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return quizStateSchema.parse(JSON.parse(plaintext));
}
