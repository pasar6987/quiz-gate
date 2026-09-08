# Privacy

Quiz Gate does not maintain an application database and does not intentionally persist request bodies.

The GitHub App server receives GitHub installation and pull-request webhook metadata, plus result attestations containing the repository identity, pull request number, commit SHA, score, threshold, actor, and workflow run ID. It uses that data synchronously to open setup pull requests and update GitHub checks. Platform request logs may retain ordinary HTTP metadata according to the hosting provider's settings.

Pull request titles, descriptions, diffs, quiz questions, answers, answer keys, and LLM credentials are not sent to the Quiz Gate server. The repository-owned GitHub Actions workflow sends PR content directly to the LLM endpoint selected in `.quiz-gate.yml`. That provider's privacy and retention terms apply.

The answer key is encrypted into a hidden PR-comment marker with AES-256-GCM. The encryption key is derived from a repository secret or provider credential and is never sent to the Quiz Gate server.
