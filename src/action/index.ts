import { readFile } from "node:fs/promises";
import { parseQuizGateConfig } from "../shared/config.js";
import type { GateAttestation } from "../shared/schemas.js";
import { generateQuiz } from "./generate.js";
import { GitHubClient, requestOidcToken, type PullRequestInfo } from "./github.js";
import {
  countAttempts,
  extractSealedState,
  hasPassingResult,
  isTrustedAutomationComment,
  parseAnswers,
  QUIZ_MARKER,
  renderQuizComment,
  renderResultComment,
} from "./markdown.js";
import { resolveProvider, type ProviderSecrets } from "./providers.js";
import { openQuizState, sealQuizState, type QuizState } from "./state.js";

interface PullRequestEvent {
  action: string;
  repository: { id: number; full_name: string };
  pull_request: PullRequestInfo;
}

interface IssueCommentEvent {
  action: string;
  repository: { id: number; full_name: string };
  issue: { number: number; pull_request?: { url: string } };
  comment: {
    body: string;
    user: { login: string };
    author_association: string;
    created_at: string;
  };
}

function input(name: string): string | undefined {
  const value = process.env[`INPUT_${name.toUpperCase()}`]?.trim();
  return value || undefined;
}

function requiredInput(name: string): string {
  const value = input(name);
  if (!value) throw new Error(`Missing action input: ${name}`);
  return value;
}

function providerSecrets(): ProviderSecrets {
  const apiKey = input("api_key");
  const bedrockApiKey = input("bedrock_api_key");
  const awsAccessKeyId = input("aws_access_key_id");
  const awsSecretAccessKey = input("aws_secret_access_key");
  const awsSessionToken = input("aws_session_token");
  const stateSecret = input("state_secret");
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(bedrockApiKey ? { bedrockApiKey } : {}),
    ...(awsAccessKeyId ? { awsAccessKeyId } : {}),
    ...(awsSecretAccessKey ? { awsSecretAccessKey } : {}),
    ...(awsSessionToken ? { awsSessionToken } : {}),
    ...(stateSecret ? { stateSecret } : {}),
  };
}

async function loadEvent(): Promise<unknown> {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("GITHUB_EVENT_PATH is unavailable.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function submitAttestation(attestation: GateAttestation): Promise<void> {
  const url = requiredInput("attestation_url");
  const audience = input("attestation_audience") ?? "quiz-gate";
  const oidcToken = await requestOidcToken(audience);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
      "user-agent": "quiz-gate-action/0.1.0",
    },
    body: JSON.stringify(attestation),
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1_000);
    throw new Error(`Quiz Gate attestation failed (${response.status}): ${message}`);
  }
}

function baseAttestation(inputValue: {
  repository: string;
  repositoryId: string;
  pr: PullRequestInfo;
  actor?: string;
}): Omit<GateAttestation, "status"> {
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId) throw new Error("GITHUB_RUN_ID is unavailable.");
  return {
    version: 1,
    repository: inputValue.repository,
    repository_id: inputValue.repositoryId,
    pr_number: inputValue.pr.number,
    head_sha: inputValue.pr.head.sha,
    run_id: runId,
    ...(inputValue.actor ? { actor: inputValue.actor } : {}),
  };
}

async function loadConfig(
  github: GitHubClient,
  baseSha: string,
): Promise<ReturnType<typeof parseQuizGateConfig>> {
  const configPath = input("config_path") ?? ".quiz-gate.yml";
  const source = await github.getContent(configPath, baseSha);
  return parseQuizGateConfig(source);
}

function canAnswer(
  mode: "author" | "collaborators" | "anyone",
  actor: string,
  association: string,
  prAuthor: string,
): boolean {
  if (mode === "anyone") return true;
  if (actor.toLowerCase() === prAuthor.toLowerCase()) return true;
  if (mode === "author") return false;
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(association);
}

async function generateForPullRequest(
  event: PullRequestEvent,
  github: GitHubClient,
): Promise<void> {
  const pr = event.pull_request;
  if (pr.draft && event.action !== "ready_for_review") return;
  const repositoryId = String(event.repository.id);
  const config = await loadConfig(github, pr.base.sha);
  const attestation = baseAttestation({
    repository: event.repository.full_name,
    repositoryId,
    pr,
  });

  if (!config.enabled) {
    await submitAttestation({
      ...attestation,
      status: "completed",
      conclusion: "neutral",
    });
    return;
  }

  const comments = await github.listIssueComments(pr.number);
  if (
    comments.some(
      (comment) =>
        isTrustedAutomationComment(comment) &&
        comment.body.includes(QUIZ_MARKER) &&
        comment.body.includes(`<!-- quiz-gate-sha:${pr.head.sha} -->`),
    )
  ) {
    return;
  }

  const provider = resolveProvider(config, providerSecrets());
  const diff = await github.getPullRequestDiff(
    pr.number,
    config.quiz.max_diff_chars,
  );
  const quiz = await generateQuiz({
    config,
    provider,
    title: pr.title,
    body: pr.body,
    diff,
  });
  const state: QuizState = {
    version: 1,
    repository_id: repositoryId,
    pr_number: pr.number,
    head_sha: pr.head.sha,
    created_at: new Date().toISOString(),
    threshold: config.quiz.pass_threshold,
    answer_command: config.quiz.answer_command,
    questions: quiz.questions.map(({ id, correct_option }) => ({
      id,
      correct_option,
    })),
  };
  const sealedState = sealQuizState(state, provider.stateSecret);
  await github.createIssueComment(
    pr.number,
    renderQuizComment({
      quiz,
      state,
      sealedState,
      provider: `${provider.displayName}/${config.provider.model}`,
    }),
  );
  await submitAttestation({ ...attestation, status: "in_progress" });
}

async function gradeIssueComment(
  event: IssueCommentEvent,
  github: GitHubClient,
): Promise<void> {
  if (!event.issue.pull_request || event.action !== "created") return;
  const pr = await github.getPullRequest(event.issue.number);
  const config = await loadConfig(github, pr.base.sha);
  const firstToken = event.comment.body.trim().split(/\s+/, 1)[0];
  if (firstToken?.toLowerCase() !== config.quiz.answer_command.toLowerCase()) {
    return;
  }

  const actor = event.comment.user.login;
  if (
    !canAnswer(
      config.quiz.answerers,
      actor,
      event.comment.author_association,
      pr.user.login,
    )
  ) {
    throw new Error(`${actor} is not allowed to answer this pull request quiz.`);
  }

  const comments = await github.listIssueComments(pr.number);
  if (hasPassingResult(comments, pr.head.sha)) return;
  const currentQuizComments = comments
    .filter(
      (comment) =>
        isTrustedAutomationComment(comment) &&
        comment.body.includes(QUIZ_MARKER) &&
        comment.body.includes(`<!-- quiz-gate-sha:${pr.head.sha} -->`),
    )
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  const quizComment = currentQuizComments[0];
  if (!quizComment) {
    throw new Error("No Quiz Gate challenge exists for the current pull request commit.");
  }
  if (event.comment.created_at <= quizComment.created_at) {
    throw new Error("This answer predates the quiz for the current commit.");
  }

  const sealedState = extractSealedState(quizComment.body);
  if (!sealedState) throw new Error("The Quiz Gate challenge state is missing.");
  const provider = resolveProvider(config, providerSecrets());
  const repositoryId = String(event.repository.id);
  const state = openQuizState(sealedState, provider.stateSecret, repositoryId);
  if (state.head_sha !== pr.head.sha || state.pr_number !== pr.number) {
    throw new Error("The quiz is stale. Push or request a fresh quiz for the latest commit.");
  }

  const previousAttempts = countAttempts(comments, pr.head.sha, actor);
  const attempt = previousAttempts + 1;
  if (attempt > config.quiz.max_attempts) {
    await submitAttestation({
      ...baseAttestation({
        repository: event.repository.full_name,
        repositoryId,
        pr,
        actor,
      }),
      status: "completed",
      conclusion: "action_required",
      score: 0,
      threshold: state.threshold,
    });
    throw new Error(`Maximum attempts (${config.quiz.max_attempts}) reached.`);
  }

  const answers = parseAnswers(
    event.comment.body,
    state.answer_command,
    state.questions.map((question) => question.id),
  );
  const incorrectIds = state.questions
    .filter((question) => answers.get(question.id) !== question.correct_option)
    .map((question) => question.id);
  const correct = state.questions.length - incorrectIds.length;
  const score = Math.round((correct / state.questions.length) * 100);
  const passed = score >= state.threshold;

  await github.createIssueComment(
    pr.number,
    renderResultComment({
      headSha: pr.head.sha,
      actor,
      score,
      threshold: state.threshold,
      passed,
      incorrectIds,
      attempt,
      maxAttempts: config.quiz.max_attempts,
    }),
  );
  await submitAttestation({
    ...baseAttestation({
      repository: event.repository.full_name,
      repositoryId,
      pr,
      actor,
    }),
    status: "completed",
    conclusion: passed ? "success" : "failure",
    score,
    threshold: state.threshold,
  });
}

export async function run(): Promise<void> {
  const token = requiredInput("github_token");
  const repository = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!repository || !eventName) {
    throw new Error("This action must run inside GitHub Actions.");
  }
  const github = new GitHubClient({
    token,
    repository,
    ...(process.env.GITHUB_API_URL ? { apiUrl: process.env.GITHUB_API_URL } : {}),
  });
  const event = await loadEvent();

  if (eventName === "pull_request_target") {
    await generateForPullRequest(event as PullRequestEvent, github);
    return;
  }
  if (eventName === "issue_comment") {
    await gradeIssueComment(event as IssueCommentEvent, github);
    return;
  }
  throw new Error(`Unsupported GitHub event: ${eventName}`);
}

if (process.env.NODE_ENV !== "test") {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error title=Quiz Gate failed::${message.replaceAll("\n", "%0A")}`);
    process.exitCode = 1;
  });
}
