import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const providerKinds = [
  "openai",
  "chatgpt",
  "anthropic",
  "claude",
  "bedrock",
  "sakana",
  "openai-compatible",
] as const;

const providerSchema = z
  .object({
    kind: z.enum(providerKinds).default("openai"),
    model: z.string().trim().min(1).default("gpt-5.4-mini"),
    api: z.enum(["responses", "chat"]).default("responses"),
    base_url: z.string().url().optional(),
    region: z.string().trim().min(1).default("us-east-1"),
  })
  .superRefine((provider, context) => {
    if (
      (provider.kind === "sakana" || provider.kind === "openai-compatible") &&
      !provider.base_url
    ) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: `${provider.kind} requires provider.base_url`,
      });
    }
  });

const quizSchema = z.object({
  question_count: z.number().int().min(1).max(20).default(5),
  pass_threshold: z.number().min(0).max(100).default(80),
  instructions: z
    .string()
    .max(8_000)
    .default(
      "Ask questions that verify the author understands the intent, behavior, risks, and trade-offs of the change.",
    ),
  language: z.string().trim().min(2).max(32).default("ko"),
  answer_command: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9_-]+$/i)
    .default("/quiz"),
  answerers: z.enum(["author", "collaborators", "anyone"]).default("author"),
  max_attempts: z.number().int().min(1).max(20).default(3),
  max_diff_chars: z.number().int().min(2_000).max(200_000).default(60_000),
});

export const quizGateConfigSchema = z.object({
  version: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  provider: providerSchema.default({
    kind: "openai",
    model: "gpt-5.4-mini",
    api: "responses",
    region: "us-east-1",
  }),
  quiz: quizSchema.default({
    question_count: 5,
    pass_threshold: 80,
    instructions:
      "Ask questions that verify the author understands the intent, behavior, risks, and trade-offs of the change.",
    language: "ko",
    answer_command: "/quiz",
    answerers: "author",
    max_attempts: 3,
    max_diff_chars: 60_000,
  }),
});

export type QuizGateConfig = z.infer<typeof quizGateConfigSchema>;
export type ProviderKind = (typeof providerKinds)[number];

export function parseQuizGateConfig(source?: string | null): QuizGateConfig {
  if (!source?.trim()) {
    return quizGateConfigSchema.parse({});
  }

  const parsed = parseYaml(source) as unknown;
  return quizGateConfigSchema.parse(parsed);
}
