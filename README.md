# Quiz Gate

Quiz Gate is an open-source, bring-your-own-key GitHub merge gate. It asks the pull request author a configurable multiple-choice quiz about their change and publishes a GitHub App-owned **Quiz Gate** check that can be required before merge.

The hosted component is intentionally headless and stateless. Your repository's GitHub Actions runner sends the PR diff directly to your chosen LLM provider. The Quiz Gate server receives only a short GitHub OIDC-signed result attestation.

## What gets installed

Installing the GitHub App opens a setup pull request containing:

- `.github/workflows/quiz-gate.yml` — the trusted workflow
- `.github/quiz-gate/` — a vendored, reviewable JavaScript action
- `.quiz-gate.yml` — provider and quiz policy

After merging the setup PR, add your provider credential under **Settings → Secrets and variables → Actions**. Use `QUIZ_GATE_API_KEY` for OpenAI, Anthropic, Sakana, and OpenAI-compatible APIs. Bedrock can use `QUIZ_GATE_BEDROCK_API_KEY` or the `QUIZ_GATE_AWS_*` secrets.

Finally, add the **Quiz Gate** check to a branch ruleset and choose this GitHub App as its expected source. Until that rule is enabled, the quiz runs but does not block merging.

## Configuration

Repository owners control the model, prompt, question count, and pass mark in `.quiz-gate.yml`:

```yaml
version: 1
enabled: true

provider:
  kind: openai
  model: gpt-5.4-mini
  api: responses

quiz:
  question_count: 5
  pass_threshold: 80
  language: ko
  answer_command: /quiz
  answerers: author
  max_attempts: 3
  max_diff_chars: 60000
  instructions: >-
    Verify that the author understands behavior, failure modes, security risks,
    rollback strategy, and the important trade-offs in this change.
```

The author answers in a PR comment, for example:

```text
/quiz 1:B 2:A 3:D 4:C 5:B
```

Grading is deterministic. The LLM generates the questions and answer key once; it does not judge the author's response.

### Providers

OpenAI and ChatGPT API:

```yaml
provider:
  kind: openai # "chatgpt" is an alias
  model: gpt-5.4-mini
  api: responses
```

Anthropic and Claude API:

```yaml
provider:
  kind: anthropic # "claude" is an alias
  model: claude-sonnet-4-6
```

Sakana Fugu:

```yaml
provider:
  kind: sakana
  model: fugu
  api: chat
  base_url: https://YOUR-SAKANA-OPENAI-COMPATIBLE-ENDPOINT/v1
```

Amazon Bedrock:

```yaml
provider:
  kind: bedrock
  model: anthropic.claude-sonnet-4-6-v1:0
  region: ap-northeast-1
```

Any OpenAI-compatible API:

```yaml
provider:
  kind: openai-compatible
  model: your-model-id
  api: chat
  base_url: https://llm.example.com/v1
```

Provider adapters live in `src/action/providers.ts` and are registered with `registerProvider`, so a new AI SDK provider can be added without changing quiz generation or grading.

ChatGPT and Claude consumer subscriptions are not API credentials. Users need an API key or cloud credential issued by the corresponding provider.

## Privacy and trust model

| Data | Destination | Stored by Quiz Gate server |
|---|---|---:|
| PR title, description, diff | User-selected LLM provider, directly from GitHub Actions | No |
| Provider credential | GitHub Actions secret and provider | No |
| Questions | PR comment | No |
| Answer key | AES-256-GCM ciphertext in the PR comment | No |
| Score, PR number, commit SHA | Quiz Gate attestation endpoint | No database; used to update the check |

The answer-key encryption key is derived from `QUIZ_GATE_STATE_SECRET`, or from the active provider credential when no separate state secret is set. Set a stable `QUIZ_GATE_STATE_SECRET` if keys rotate frequently.

The workflow uses `pull_request_target` so fork PRs can use repository secrets. It never checks out or executes the PR head: only trusted base-branch Quiz Gate files are checked out, and the PR diff is handled as untrusted text. Repository administrators should still review updates to the workflow and vendored action like any other privileged CI code.

Public repositories should consider provider-side spend limits because an external contributor can create or update PRs and cause bounded quiz-generation calls. Quiz Gate caps diff and output size, but a stateless deployment cannot enforce an account-wide request budget.

## Self-hosting the GitHub App server

The server is a set of Vercel Functions and requires no database.

```bash
npm install
npm run check
npm run build
```

Configure these deployment variables:

| Variable | Purpose |
|---|---|
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_PRIVATE_KEY` | App private key PEM; escaped newlines are accepted |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret configured on the GitHub App |
| `PUBLIC_BASE_URL` | Deployment origin, without a trailing slash |
| `GITHUB_APP_SLUG` | Public GitHub App slug |
| `ATTESTATION_AUDIENCE` | OIDC audience; default `quiz-gate` |
| `BOOTSTRAP_ENABLED` | Whether installation webhooks open setup PRs |

Register a public GitHub App with:

- Webhook URL: `https://YOUR_DEPLOYMENT/github/webhook`
- Repository permissions: Checks read/write, Contents read/write, Pull requests read/write, Workflows read/write, Metadata read-only
- Events: Installation, Installation repositories, Pull request

The app intentionally does not request Administration permission. Each repository owner enables the required-check ruleset themselves.

## Development

```bash
npm run check       # typecheck, lint, unit tests
npm run build       # create the vendored action bundle
```

This project is licensed under Apache-2.0.
