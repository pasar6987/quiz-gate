import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerEnv } from "./env.js";
import { GitHubAppClient, type RepositoryInfo } from "./github.js";
import {
  bundleVersion,
  defaultConfig,
  setupPullRequestBody,
  vendoredActionManifest,
  workflowTemplate,
} from "./templates.js";

export interface BootstrapResult {
  repository: string;
  status: "current" | "pull_request";
  pull_request_url?: string;
}

async function actionBundleDirectory(): Promise<string> {
  for (const root of [process.cwd(), join(process.cwd(), "..")]) {
    const directory = join(root, "dist", "action");
    try {
      await readFile(join(directory, "index.js"), "utf8");
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("The vendored Quiz Gate action bundle is missing.");
}

async function actionBundleFiles(): Promise<Record<string, string>> {
  const directory = await actionBundleDirectory();
  const names = (await readdir(directory)).filter(
    (name) => name.endsWith(".js") || name === "package.json",
  );
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        `.github/quiz-gate/dist/${name}`,
        await readFile(join(directory, name), "utf8"),
      ]),
    ),
  );
}

export async function bootstrapRepository(input: {
  env: ServerEnv;
  installationId: number;
  repository: Pick<RepositoryInfo, "full_name">;
}): Promise<BootstrapResult> {
  if (!input.env.bootstrapEnabled) {
    return { repository: input.repository.full_name, status: "current" };
  }
  const github = new GitHubAppClient(input.env);
  const repository = await github.getRepository(
    input.installationId,
    input.repository.full_name,
  );
  const [installedManifest, installedWorkflow, installedConfig] = await Promise.all([
    github.getFile(
      input.installationId,
      repository.full_name,
      ".github/quiz-gate/action.yml",
      repository.default_branch,
    ),
    github.getFile(
      input.installationId,
      repository.full_name,
      ".github/workflows/quiz-gate.yml",
      repository.default_branch,
    ),
    github.getFile(
      input.installationId,
      repository.full_name,
      ".quiz-gate.yml",
      repository.default_branch,
    ),
  ]);
  if (
    installedManifest?.includes(`quiz-gate-bundle-version: ${bundleVersion}`) &&
    installedWorkflow &&
    installedConfig
  ) {
    return { repository: repository.full_name, status: "current" };
  }

  const branch = `quiz-gate/setup-v${bundleVersion}`;
  await github.createCommitWithFiles({
    installationId: input.installationId,
    repository: repository.full_name,
    baseBranch: repository.default_branch,
    branch,
    message: `Install Quiz Gate v${bundleVersion}`,
    files: {
      ".github/workflows/quiz-gate.yml": workflowTemplate({
        attestationUrl: `${input.env.publicBaseUrl}/github/attest`,
        audience: input.env.attestationAudience,
      }),
      ".github/quiz-gate/action.yml": vendoredActionManifest(),
      ...(await actionBundleFiles()),
      ".quiz-gate.yml": installedConfig ?? defaultConfig(),
    },
  });
  const pullRequest = await github.ensurePullRequest({
    installationId: input.installationId,
    repository,
    branch,
    title: `Install Quiz Gate v${bundleVersion}`,
    body: setupPullRequestBody(),
  });
  return {
    repository: repository.full_name,
    status: "pull_request",
    pull_request_url: pullRequest.html_url,
  };
}
