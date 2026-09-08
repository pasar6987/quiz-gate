const DEFAULT_API_URL = "https://api.github.com";

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  user: { login: string };
  head: { sha: string };
  base: { sha: string; ref: string };
}

export interface IssueComment {
  id: number;
  body: string;
  user: { login: string };
  author_association: string;
  created_at: string;
}

interface ContentResponse {
  type: string;
  content?: string;
  encoding?: string;
}

interface OidcResponse {
  value: string;
}

export class GitHubClient {
  readonly #token: string;
  readonly #repository: string;
  readonly #apiUrl: string;

  constructor(input: { token: string; repository: string; apiUrl?: string }) {
    this.#token = input.token;
    this.#repository = input.repository;
    this.#apiUrl = (input.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  }

  async #request<T>(
    path: string,
    init: RequestInit = {},
    accept = "application/vnd.github+json",
  ): Promise<T> {
    const response = await fetch(`${this.#apiUrl}${path}`, {
      ...init,
      headers: {
        accept,
        authorization: `Bearer ${this.#token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "quiz-gate-action/0.1.0",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const message = (await response.text()).slice(0, 1_000);
      throw new Error(
        `GitHub API ${init.method ?? "GET"} ${path} failed (${response.status}): ${message}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async getPullRequest(number: number): Promise<PullRequestInfo> {
    return this.#request<PullRequestInfo>(
      `/repos/${this.#repository}/pulls/${number}`,
    );
  }

  async getPullRequestDiff(number: number, maxChars: number): Promise<string> {
    const response = await fetch(
      `${this.#apiUrl}/repos/${this.#repository}/pulls/${number}`,
      {
        headers: {
          accept: "application/vnd.github.v3.diff",
          authorization: `Bearer ${this.#token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "quiz-gate-action/0.1.0",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Unable to fetch pull request diff (${response.status}).`);
    }
    const diff = await response.text();
    if (diff.length <= maxChars) {
      return diff;
    }
    return `${diff.slice(0, maxChars)}\n\n[diff truncated by Quiz Gate at ${maxChars} characters]`;
  }

  async getContent(path: string, ref: string): Promise<string | null> {
    const response = await fetch(
      `${this.#apiUrl}/repos/${this.#repository}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.#token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "quiz-gate-action/0.1.0",
        },
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Unable to read ${path} (${response.status}).`);
    }
    const content = (await response.json()) as ContentResponse;
    if (content.type !== "file" || content.encoding !== "base64" || !content.content) {
      throw new Error(`${path} is not a base64-encoded file.`);
    }
    return Buffer.from(content.content.replaceAll("\n", ""), "base64").toString(
      "utf8",
    );
  }

  async listIssueComments(number: number): Promise<IssueComment[]> {
    const comments: IssueComment[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.#request<IssueComment[]>(
        `/repos/${this.#repository}/issues/${number}/comments?per_page=100&page=${page}`,
      );
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    return comments;
  }

  async createIssueComment(number: number, body: string): Promise<IssueComment> {
    return this.#request<IssueComment>(
      `/repos/${this.#repository}/issues/${number}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  }
}

export async function requestOidcToken(audience: string): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub OIDC is unavailable. Ensure the workflow grants id-token: write.",
    );
  }

  const separator = requestUrl.includes("?") ? "&" : "?";
  const response = await fetch(
    `${requestUrl}${separator}audience=${encodeURIComponent(audience)}`,
    { headers: { authorization: `Bearer ${requestToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Unable to request GitHub OIDC token (${response.status}).`);
  }
  return ((await response.json()) as OidcResponse).value;
}
