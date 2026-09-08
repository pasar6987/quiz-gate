import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import type { ServerEnv } from "./env.js";

const GITHUB_API = "https://api.github.com";
const CHECK_NAME = "Quiz Gate";

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

interface InstallationResponse {
  id: number;
}

interface CheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion?: string | null;
  app?: { id: number };
}

interface CheckRunsResponse {
  check_runs: CheckRun[];
}

export interface RepositoryInfo {
  id: number;
  full_name: string;
  default_branch: string;
  owner: { login: string };
  name: string;
}

export interface PullRequestInfo {
  number: number;
  html_url: string;
  head: { sha: string };
  base: { ref: string; sha: string };
}

interface GitReference {
  ref: string;
  object: { sha: string; type: string };
}

interface GitCommit {
  sha: string;
  tree: { sha: string };
}

interface GitBlob {
  sha: string;
}

interface GitTree {
  sha: string;
}

interface PullRequestRecord {
  number: number;
  html_url: string;
}

export function normalizePrivateKey(privateKey: string): string {
  return createPrivateKey(privateKey)
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

export class GitHubAppClient {
  readonly #env: ServerEnv;

  constructor(env: ServerEnv) {
    this.#env = env;
  }

  async #appJwt(): Promise<string> {
    const key = await importPKCS8(normalizePrivateKey(this.#env.privateKey), "RS256");
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 540)
      .setIssuer(this.#env.appId)
      .sign(key);
  }

  async #request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "quiz-gate-app/0.1.0",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 2_000);
      throw new Error(
        `GitHub API ${init.method ?? "GET"} ${path} failed (${response.status}): ${message}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async appRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.#request<T>(path, await this.#appJwt(), init);
  }

  async installationToken(installationId: number): Promise<string> {
    const response = await this.appRequest<InstallationTokenResponse>(
      `/app/installations/${installationId}/access_tokens`,
      { method: "POST" },
    );
    return response.token;
  }

  async installationForRepository(repository: string): Promise<number> {
    const installation = await this.appRequest<InstallationResponse>(
      `/repos/${repository}/installation`,
    );
    return installation.id;
  }

  async installationRequest<T>(
    installationId: number,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    return this.#request<T>(path, await this.installationToken(installationId), init);
  }

  async getRepository(
    installationId: number,
    repository: string,
  ): Promise<RepositoryInfo> {
    return this.installationRequest<RepositoryInfo>(
      installationId,
      `/repos/${repository}`,
    );
  }

  async getPullRequest(
    installationId: number,
    repository: string,
    number: number,
  ): Promise<PullRequestInfo> {
    return this.installationRequest<PullRequestInfo>(
      installationId,
      `/repos/${repository}/pulls/${number}`,
    );
  }

  async putCheck(input: {
    installationId: number;
    repository: string;
    headSha: string;
    status: "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "action_required";
    title: string;
    summary: string;
    detailsUrl?: string;
    preserveCompletedSuccess?: boolean;
  }): Promise<number> {
    const existing = await this.installationRequest<CheckRunsResponse>(
      input.installationId,
      `/repos/${input.repository}/commits/${input.headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=latest`,
    );
    const appId = Number(this.#env.appId);
    const owned = existing.check_runs.find(
      (check) => check.name === CHECK_NAME && check.app?.id === appId,
    );
    if (
      owned?.status === "completed" &&
      owned.conclusion === "success" &&
      input.status === "in_progress" &&
      input.preserveCompletedSuccess
    ) {
      return owned.id;
    }
    const output = { title: input.title, summary: input.summary };
    const sharedBody = {
      name: CHECK_NAME,
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      ...(input.status === "completed"
        ? { completed_at: new Date().toISOString() }
        : { started_at: new Date().toISOString() }),
      output,
    };

    if (owned) {
      const updated = await this.installationRequest<CheckRun>(
        input.installationId,
        `/repos/${input.repository}/check-runs/${owned.id}`,
        { method: "PATCH", body: JSON.stringify(sharedBody) },
      );
      return updated.id;
    }

    const created = await this.installationRequest<CheckRun>(
      input.installationId,
      `/repos/${input.repository}/check-runs`,
      {
        method: "POST",
        body: JSON.stringify({ ...sharedBody, head_sha: input.headSha }),
      },
    );
    return created.id;
  }

  async getFile(
    installationId: number,
    repository: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const token = await this.installationToken(installationId);
    const response = await fetch(
      `${GITHUB_API}/repos/${repository}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "quiz-gate-app/0.1.0",
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Unable to read ${repository}/${path} (${response.status}).`);
    }
    const value = (await response.json()) as {
      type: string;
      encoding?: string;
      content?: string;
    };
    if (value.type !== "file" || value.encoding !== "base64" || !value.content) {
      throw new Error(`${repository}/${path} is not a base64 file.`);
    }
    return Buffer.from(value.content.replaceAll("\n", ""), "base64").toString(
      "utf8",
    );
  }

  async createBlob(
    installationId: number,
    repository: string,
    content: string,
  ): Promise<string> {
    const blob = await this.installationRequest<GitBlob>(
      installationId,
      `/repos/${repository}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({ content, encoding: "utf-8" }),
      },
    );
    return blob.sha;
  }

  async createCommitWithFiles(input: {
    installationId: number;
    repository: string;
    baseBranch: string;
    branch: string;
    message: string;
    files: Record<string, string>;
  }): Promise<string> {
    const baseRef = await this.installationRequest<GitReference>(
      input.installationId,
      `/repos/${input.repository}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
    );
    const baseCommit = await this.installationRequest<GitCommit>(
      input.installationId,
      `/repos/${input.repository}/git/commits/${baseRef.object.sha}`,
    );
    const entries = await Promise.all(
      Object.entries(input.files).map(async ([path, content]) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: await this.createBlob(input.installationId, input.repository, content),
      })),
    );
    const tree = await this.installationRequest<GitTree>(
      input.installationId,
      `/repos/${input.repository}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }),
      },
    );
    const commit = await this.installationRequest<GitCommit>(
      input.installationId,
      `/repos/${input.repository}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.message,
          tree: tree.sha,
          parents: [baseCommit.sha],
        }),
      },
    );

    const refPath = `/repos/${input.repository}/git/refs/heads/${encodeURIComponent(input.branch)}`;
    try {
      await this.installationRequest<GitReference>(
        input.installationId,
        `/repos/${input.repository}/git/refs`,
        {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: commit.sha }),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Reference already exists")) throw error;
      await this.installationRequest<GitReference>(input.installationId, refPath, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: true }),
      });
    }
    return commit.sha;
  }

  async ensurePullRequest(input: {
    installationId: number;
    repository: RepositoryInfo;
    branch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRecord> {
    const head = `${input.repository.owner.login}:${input.branch}`;
    const existing = await this.installationRequest<PullRequestRecord[]>(
      input.installationId,
      `/repos/${input.repository.full_name}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(input.repository.default_branch)}`,
    );
    if (existing[0]) return existing[0];
    return this.installationRequest<PullRequestRecord>(
      input.installationId,
      `/repos/${input.repository.full_name}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.branch,
          base: input.repository.default_branch,
        }),
      },
    );
  }
}

export const quizGateCheckName = CHECK_NAME;
