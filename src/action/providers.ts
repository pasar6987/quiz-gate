import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { QuizGateConfig } from "../shared/config.js";

export interface ProviderSecrets {
  apiKey?: string;
  bedrockApiKey?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  stateSecret?: string;
}

export interface ResolvedProvider {
  model: LanguageModel;
  stateSecret: string;
  displayName: string;
}

type ProviderBuilder = (
  config: QuizGateConfig,
  secrets: ProviderSecrets,
) => ResolvedProvider;

const builders = new Map<string, ProviderBuilder>();

export function registerProvider(kind: string, builder: ProviderBuilder): void {
  builders.set(kind, builder);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required GitHub Actions secret: ${name}`);
  }
  return value;
}

function secretForState(
  explicit: string | undefined,
  credential: string | undefined,
): string {
  return explicit ?? required(credential, "QUIZ_GATE_STATE_SECRET");
}

function buildOpenAI(
  config: QuizGateConfig,
  secrets: ProviderSecrets,
  name = "openai",
): ResolvedProvider {
  const apiKey = required(secrets.apiKey, "QUIZ_GATE_API_KEY");
  const provider = createOpenAI({
    apiKey,
    name,
    ...(config.provider.base_url
      ? { baseURL: config.provider.base_url.replace(/\/$/, "") }
      : {}),
  });

  return {
    model:
      config.provider.api === "chat"
        ? provider.chat(config.provider.model)
        : provider.responses(config.provider.model),
    stateSecret: secretForState(secrets.stateSecret, apiKey),
    displayName: name,
  };
}

function buildAnthropic(
  config: QuizGateConfig,
  secrets: ProviderSecrets,
): ResolvedProvider {
  const apiKey = required(secrets.apiKey, "QUIZ_GATE_API_KEY");
  const provider = createAnthropic({
    apiKey,
    ...(config.provider.base_url ? { baseURL: config.provider.base_url } : {}),
  });

  return {
    model: provider(config.provider.model),
    stateSecret: secretForState(secrets.stateSecret, apiKey),
    displayName: "anthropic",
  };
}

function buildBedrock(
  config: QuizGateConfig,
  secrets: ProviderSecrets,
): ResolvedProvider {
  const bedrockApiKey = secrets.bedrockApiKey;
  const accessKeyId = secrets.awsAccessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    secrets.awsSecretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = secrets.awsSessionToken ?? process.env.AWS_SESSION_TOKEN;

  if (!bedrockApiKey && (!accessKeyId || !secretAccessKey)) {
    throw new Error(
      "Bedrock requires QUIZ_GATE_BEDROCK_API_KEY or AWS credentials configured in the workflow.",
    );
  }

  const provider = createAmazonBedrock({
    region: config.provider.region,
    ...(bedrockApiKey ? { apiKey: bedrockApiKey } : {}),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(sessionToken ? { sessionToken } : {}),
  });

  return {
    model: provider(config.provider.model),
    stateSecret: secretForState(
      secrets.stateSecret,
      bedrockApiKey ?? secretAccessKey,
    ),
    displayName: "amazon-bedrock",
  };
}

registerProvider("openai", (config, secrets) =>
  buildOpenAI(config, secrets),
);
registerProvider("chatgpt", (config, secrets) =>
  buildOpenAI(config, secrets),
);
registerProvider("openai-compatible", (config, secrets) =>
  buildOpenAI(config, secrets, "openai-compatible"),
);
registerProvider("sakana", (config, secrets) =>
  buildOpenAI(config, secrets, "sakana"),
);
registerProvider("anthropic", buildAnthropic);
registerProvider("claude", buildAnthropic);
registerProvider("bedrock", buildBedrock);

export function resolveProvider(
  config: QuizGateConfig,
  secrets: ProviderSecrets,
): ResolvedProvider {
  const builder = builders.get(config.provider.kind);
  if (!builder) {
    throw new Error(`Unsupported provider: ${config.provider.kind}`);
  }
  return builder(config, secrets);
}
