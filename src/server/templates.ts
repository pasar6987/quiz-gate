export const bundleVersion = "0.1.0";

const checkoutCommit = "11bd71901bbe5b1630ceea73d27597364c9af683";

export function vendoredActionManifest(): string {
  return `# quiz-gate-bundle-version: ${bundleVersion}
name: Quiz Gate
description: Generate and grade a pull-request understanding quiz with the repository owner's LLM credentials.
inputs:
  github_token:
    description: GitHub token supplied by the workflow.
    required: true
  api_key:
    description: OpenAI, Anthropic, Sakana, or OpenAI-compatible API key.
    required: false
  bedrock_api_key:
    description: Amazon Bedrock API key.
    required: false
  aws_access_key_id:
    description: AWS access key ID when Bedrock API keys are not used.
    required: false
  aws_secret_access_key:
    description: AWS secret access key when Bedrock API keys are not used.
    required: false
  aws_session_token:
    description: Optional AWS session token.
    required: false
  state_secret:
    description: Optional stable secret used only to encrypt quiz state in PR comments.
    required: false
  attestation_url:
    description: Quiz Gate server endpoint that owns the required check.
    required: true
  attestation_audience:
    description: GitHub Actions OIDC audience expected by the server.
    required: false
    default: quiz-gate
  config_path:
    description: Configuration file path on the trusted base branch.
    required: false
    default: .quiz-gate.yml
runs:
  using: node20
  main: dist/index.js
`;
}

function attestationPreflightStep(input: {
  attestationUrl: string;
  audience: string;
}): string {
  return `      - name: Start Quiz Gate check
        if: github.event_name == 'pull_request_target'
        shell: bash
        env:
          QUIZ_GATE_ATTESTATION_URL: ${JSON.stringify(input.attestationUrl)}
          QUIZ_GATE_ATTESTATION_AUDIENCE: ${JSON.stringify(input.audience)}
        run: |
          set -euo pipefail

          separator='?'
          if [[ "$ACTIONS_ID_TOKEN_REQUEST_URL" == *'?'* ]]; then
            separator='&'
          fi
          encoded_audience="$(jq -rn --arg value "$QUIZ_GATE_ATTESTATION_AUDIENCE" '$value | @uri')"
          oidc_url="$ACTIONS_ID_TOKEN_REQUEST_URL$separator""audience=$encoded_audience"
          oidc_response="$(curl --fail-with-body --silent --show-error \\
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$oidc_url")"
          oidc_token="$(jq -er '.value' <<<"$oidc_response")"

          repository="$(jq -er '.repository.full_name' "$GITHUB_EVENT_PATH")"
          repository_id="$(jq -er '.repository.id | tostring' "$GITHUB_EVENT_PATH")"
          pr_number="$(jq -er '.pull_request.number' "$GITHUB_EVENT_PATH")"
          head_sha="$(jq -er '.pull_request.head.sha' "$GITHUB_EVENT_PATH")"
          payload="$(jq -nc \\
            --arg repository "$repository" \\
            --arg repository_id "$repository_id" \\
            --argjson pr_number "$pr_number" \\
            --arg head_sha "$head_sha" \\
            --arg run_id "$GITHUB_RUN_ID" \\
            '{version: 1, repository: $repository, repository_id: $repository_id, pr_number: $pr_number, head_sha: $head_sha, status: "in_progress", run_id: $run_id}')"

          curl --fail-with-body --silent --show-error \\
            -X POST \\
            -H "Authorization: Bearer $oidc_token" \\
            -H "Content-Type: application/json" \\
            --data "$payload" \\
            "$QUIZ_GATE_ATTESTATION_URL" \\
            > /dev/null
          echo "Quiz Gate check started."

`;
}

export function workflowTemplate(input: {
  attestationUrl: string;
  audience: string;
}): string {
  return `# Installed by Quiz Gate. The pull request head is deliberately never checked out.
name: Quiz Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: read
  issues: write
  id-token: write

jobs:
  quiz:
    if: >-
      github.event_name == 'pull_request_target' ||
      github.event.issue.pull_request != null
    runs-on: ubuntu-latest
    timeout-minutes: 10
    concurrency:
      group: quiz-gate-\${{ github.event.issue.number || github.event.pull_request.number }}
      cancel-in-progress: false
    steps:
      - name: Check out trusted Quiz Gate files
        uses: actions/checkout@${checkoutCommit}
        with:
          ref: \${{ github.event_name == 'pull_request_target' && github.base_ref || github.event.repository.default_branch }}
          sparse-checkout: |
            .github/quiz-gate
            .quiz-gate.yml
          persist-credentials: false

${attestationPreflightStep(input)}      - name: Generate or grade the quiz
        uses: ./.github/quiz-gate
        with:
          github_token: \${{ github.token }}
          api_key: \${{ secrets.QUIZ_GATE_API_KEY }}
          bedrock_api_key: \${{ secrets.QUIZ_GATE_BEDROCK_API_KEY }}
          aws_access_key_id: \${{ secrets.QUIZ_GATE_AWS_ACCESS_KEY_ID }}
          aws_secret_access_key: \${{ secrets.QUIZ_GATE_AWS_SECRET_ACCESS_KEY }}
          aws_session_token: \${{ secrets.QUIZ_GATE_AWS_SESSION_TOKEN }}
          state_secret: \${{ secrets.QUIZ_GATE_STATE_SECRET }}
          attestation_url: ${JSON.stringify(input.attestationUrl)}
          attestation_audience: ${JSON.stringify(input.audience)}
`;
}

export function defaultConfig(): string {
  return `# Quiz Gate configuration. Secrets stay in GitHub Actions; never put keys here.
version: 1
enabled: true

provider:
  # openai | chatgpt | anthropic | claude | bedrock | sakana | openai-compatible
  kind: openai
  model: gpt-5.4-mini
  # OpenAI-compatible providers may select responses or chat.
  api: responses
  # Sakana and generic OpenAI-compatible providers require their API base URL.
  # base_url: https://api.example.com/v1
  # Used by Amazon Bedrock.
  region: us-east-1

quiz:
  question_count: 5
  pass_threshold: 80
  language: ko
  answer_command: /quiz
  answerers: author
  max_attempts: 3
  max_diff_chars: 60000
  instructions: >-
    Ask questions that verify the author understands the intent, behavior,
    risks, and trade-offs of the change. Focus on material code changes.
`;
}

export function setupPullRequestBody(): string {
  return `## Quiz Gate setup

This pull request installs a repository-local Quiz Gate action, its trusted workflow, and an editable configuration file.

Before merging:

1. Add the provider credential as the repository or organization secret \`QUIZ_GATE_API_KEY\`.
2. For Bedrock, use \`QUIZ_GATE_BEDROCK_API_KEY\` or the three \`QUIZ_GATE_AWS_*\` secrets instead.
3. Optionally add \`QUIZ_GATE_STATE_SECRET\` so outstanding quizzes survive provider-key rotation.
4. Edit \`.quiz-gate.yml\` to choose the model, generation instructions, question count, and pass threshold.
5. After this PR is merged and one quiz has run, require the **Quiz Gate** check in the target branch's ruleset and select this GitHub App as the expected source.

The workflow uses \`pull_request_target\` so secrets are available for fork PRs, but it checks out only the trusted default branch. PR code is fetched as inert diff text and is never executed. Quiz Gate's server receives only a signed result attestation—not your diff, prompt, answers, or provider key.
`;
}
