import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { parseQuizGateConfig } from "../shared/config.js";
import { attestationSchema, type GateAttestation } from "../shared/schemas.js";
import type { ServerEnv } from "./env.js";
import { GitHubAppClient } from "./github.js";

const githubActionsKeys = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

function claim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`GitHub OIDC claim ${name} is missing.`);
  }
  return String(value);
}

function assertResultIntegrity(
  attestation: GateAttestation,
  config: ReturnType<typeof parseQuizGateConfig>,
): void {
  if (attestation.status === "in_progress") {
    if (attestation.conclusion) {
      throw new Error("An in-progress attestation cannot have a conclusion.");
    }
    return;
  }
  if (attestation.conclusion === "neutral") {
    if (config.enabled) {
      throw new Error("A neutral result is allowed only when Quiz Gate is disabled.");
    }
    return;
  }
  if (attestation.threshold !== config.quiz.pass_threshold) {
    throw new Error("The attested threshold does not match .quiz-gate.yml.");
  }
  if (attestation.score === undefined) {
    throw new Error("A completed quiz result requires a score.");
  }
  if (
    attestation.conclusion === "success" &&
    attestation.score < config.quiz.pass_threshold
  ) {
    throw new Error("A passing result is below the configured threshold.");
  }
  if (
    attestation.conclusion === "failure" &&
    attestation.score >= config.quiz.pass_threshold
  ) {
    throw new Error("A failing result meets the configured threshold.");
  }
}

export async function attestFromGitHubActions(input: {
  env: ServerEnv;
  oidcToken: string;
  body: unknown;
}): Promise<{ check_run_id: number }> {
  const { payload } = await jwtVerify(input.oidcToken, githubActionsKeys, {
    issuer: "https://token.actions.githubusercontent.com",
    audience: input.env.attestationAudience,
  });
  const attestation = attestationSchema.parse(input.body);
  if (claim(payload, "repository") !== attestation.repository) {
    throw new Error("OIDC repository does not match the attestation.");
  }
  if (claim(payload, "repository_id") !== attestation.repository_id) {
    throw new Error("OIDC repository ID does not match the attestation.");
  }
  if (claim(payload, "run_id") !== attestation.run_id) {
    throw new Error("OIDC run ID does not match the attestation.");
  }
  if (attestation.actor && claim(payload, "actor") !== attestation.actor) {
    throw new Error("OIDC actor does not match the attestation.");
  }

  const eventName = claim(payload, "event_name");
  if (!["pull_request_target", "issue_comment"].includes(eventName)) {
    throw new Error(`Unsupported GitHub Actions event: ${eventName}`);
  }
  if (attestation.status === "in_progress" && eventName !== "pull_request_target") {
    throw new Error("Only the pull-request workflow can start a Quiz Gate check.");
  }
  if (
    attestation.status === "completed" &&
    attestation.conclusion === "neutral" &&
    eventName !== "pull_request_target"
  ) {
    throw new Error("Only the pull-request workflow can publish a neutral result.");
  }
  if (
    attestation.status === "completed" &&
    attestation.conclusion !== "neutral" &&
    eventName !== "issue_comment"
  ) {
    throw new Error("Only the answer workflow can publish a quiz result.");
  }

  const github = new GitHubAppClient(input.env);
  const installationId = await github.installationForRepository(
    attestation.repository,
  );
  const [repository, pullRequest] = await Promise.all([
    github.getRepository(installationId, attestation.repository),
    github.getPullRequest(
      installationId,
      attestation.repository,
      attestation.pr_number,
    ),
  ]);
  if (String(repository.id) !== attestation.repository_id) {
    throw new Error("Installed repository ID does not match the attestation.");
  }
  if (pullRequest.head.sha !== attestation.head_sha) {
    throw new Error("The attestation targets a stale pull request commit.");
  }

  const trustedBranch =
    eventName === "pull_request_target"
      ? pullRequest.base.ref
      : repository.default_branch;
  const expectedRef = `refs/heads/${trustedBranch}`;
  const expectedWorkflowRef = `${attestation.repository}/.github/workflows/quiz-gate.yml@${expectedRef}`;
  if (claim(payload, "ref") !== expectedRef) {
    throw new Error("The workflow did not run from the trusted branch.");
  }
  if (claim(payload, "workflow_ref") !== expectedWorkflowRef) {
    throw new Error("The OIDC token was not issued to the trusted Quiz Gate workflow.");
  }

  const configSource = await github.getFile(
    installationId,
    attestation.repository,
    ".quiz-gate.yml",
    pullRequest.base.sha,
  );
  const config = parseQuizGateConfig(configSource);
  assertResultIntegrity(attestation, config);

  const checkRunId = await github.putCheck({
    installationId,
    repository: attestation.repository,
    headSha: attestation.head_sha,
    status: attestation.status,
    ...(attestation.conclusion ? { conclusion: attestation.conclusion } : {}),
    title:
      attestation.status === "in_progress"
        ? "Waiting for the pull request author"
        : attestation.conclusion === "success"
          ? `Passed with ${attestation.score}%`
          : attestation.conclusion === "neutral"
            ? "Quiz Gate is disabled"
            : `Not passed (${attestation.score ?? 0}%)`,
    summary:
      attestation.status === "in_progress"
        ? "Answer the quiz posted on this pull request to unlock the merge check."
        : `Result attested by GitHub Actions run ${attestation.run_id}.`,
    detailsUrl: `${pullRequest.html_url}#issuecomment-new`,
  });
  return { check_run_id: checkRunId };
}
