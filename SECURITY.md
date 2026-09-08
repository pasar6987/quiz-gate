# Security

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose repository code, provider credentials, encrypted answer keys, or allow a check result to be forged. Use GitHub's private vulnerability reporting feature for this repository.

Include the affected commit, a minimal reproduction, and the impact. Please avoid accessing data that is not yours or testing against installations you do not control.

## Boundaries

- The hosted service is stateless and has no application database.
- GitHub App webhook requests are verified with HMAC-SHA256 over the raw body.
- Result submissions require a GitHub Actions OIDC token whose repository, repository ID, run ID, actor, event, branch ref, and exact workflow path match the current pull request.
- The server independently checks the current PR head SHA and the pass threshold in the trusted base-branch configuration before updating its check.
- PR head code is never checked out or executed by the privileged `pull_request_target` workflow.
- Provider credentials remain GitHub Actions secrets and are sent only to the configured provider.

Anyone with write access to a repository can change its trusted workflow or configuration. Protect those files with normal review and branch-rule controls.
