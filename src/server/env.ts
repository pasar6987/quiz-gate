export interface ServerEnv {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  publicBaseUrl: string;
  appSlug?: string;
  bootstrapEnabled: boolean;
  attestationAudience: string;
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = read(name);
  if (!value) return fallback;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be true or false.`);
}

export function serverEnv(): ServerEnv {
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
  const appSlug = read("GITHUB_APP_SLUG");
  new URL(publicBaseUrl);

  return {
    appId: required("GITHUB_APP_ID"),
    privateKey: required("GITHUB_PRIVATE_KEY").replaceAll("\\n", "\n"),
    webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
    publicBaseUrl,
    ...(appSlug ? { appSlug } : {}),
    bootstrapEnabled: boolean("BOOTSTRAP_ENABLED", true),
    attestationAudience: read("ATTESTATION_AUDIENCE") ?? "quiz-gate",
  };
}

export function configurationStatus(): Record<string, boolean> {
  return {
    github_app_id: Boolean(read("GITHUB_APP_ID")),
    github_private_key: Boolean(read("GITHUB_PRIVATE_KEY")),
    github_webhook_secret: Boolean(read("GITHUB_WEBHOOK_SECRET")),
    public_base_url: Boolean(read("PUBLIC_BASE_URL")),
    github_app_slug: Boolean(read("GITHUB_APP_SLUG")),
  };
}
