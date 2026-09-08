import { bootstrapRepository } from "./bootstrap.js";
import type { ServerEnv } from "./env.js";
import { GitHubAppClient } from "./github.js";

interface WebhookRepository {
  id: number;
  full_name: string;
}

interface InstallationEvent {
  action: string;
  installation: { id: number };
  repositories?: WebhookRepository[];
  repositories_added?: WebhookRepository[];
}

interface PullRequestEvent {
  action: string;
  installation: { id: number };
  repository: WebhookRepository;
  pull_request: {
    number: number;
    html_url: string;
    draft: boolean;
    head: { sha: string };
  };
}

function repositoriesForInstallationEvent(
  eventName: string,
  payload: InstallationEvent,
): WebhookRepository[] {
  if (eventName === "installation") return payload.repositories ?? [];
  if (eventName === "installation_repositories") {
    return payload.repositories_added ?? [];
  }
  return [];
}

export async function handleWebhook(input: {
  env: ServerEnv;
  eventName: string;
  payload: unknown;
}): Promise<unknown> {
  if (input.eventName === "ping") return { event: "ping", status: "ok" };

  if (
    input.eventName === "installation" ||
    input.eventName === "installation_repositories"
  ) {
    const payload = input.payload as InstallationEvent;
    const shouldBootstrap =
      (input.eventName === "installation" && payload.action === "created") ||
      (input.eventName === "installation_repositories" && payload.action === "added");
    if (!shouldBootstrap) {
      return { event: input.eventName, status: "ignored", action: payload.action };
    }
    const repositories = repositoriesForInstallationEvent(input.eventName, payload);
    const results = await Promise.allSettled(
      repositories.map((repository) =>
        bootstrapRepository({
          env: input.env,
          installationId: payload.installation.id,
          repository,
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Quiz Gate bootstrap failed for ${repositories[index]?.full_name ?? "unknown repository"}:`,
          result.reason,
        );
      }
    });
    return {
      event: input.eventName,
      status: "processed",
      repositories: results.map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : {
              repository: repositories[index]?.full_name,
              status: "error",
            },
      ),
    };
  }

  if (input.eventName === "pull_request") {
    const payload = input.payload as PullRequestEvent;
    if (
      !["opened", "reopened", "synchronize", "ready_for_review"].includes(
        payload.action,
      )
    ) {
      return { event: input.eventName, status: "ignored", action: payload.action };
    }
    const github = new GitHubAppClient(input.env);
    const checkRunId = await github.putCheck({
      installationId: payload.installation.id,
      repository: payload.repository.full_name,
      headSha: payload.pull_request.head.sha,
      status: "in_progress",
      title: "Preparing an understanding quiz",
      summary:
        "The repository-owned GitHub Actions workflow will generate the quiz with its configured LLM provider.",
      detailsUrl: payload.pull_request.html_url,
      preserveCompletedSuccess: true,
    });
    return {
      event: input.eventName,
      status: "processed",
      check_run_id: checkRunId,
    };
  }

  return { event: input.eventName, status: "ignored" };
}
