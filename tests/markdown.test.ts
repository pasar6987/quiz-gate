import { describe, expect, it } from "vitest";
import {
  countAttempts,
  extractSealedState,
  hasPassingResult,
  parseAnswers,
  renderQuizComment,
} from "../src/action/markdown.js";

describe("quiz comments", () => {
  it("parses numbered answers", () => {
    expect([...parseAnswers("/quiz 1:B 2=A 3) d", "/quiz", [1, 2, 3])]).toEqual([
      [1, "B"],
      [2, "A"],
      [3, "D"],
    ]);
  });

  it("rejects incomplete answers", () => {
    expect(() => parseAnswers("/quiz 1:A", "/quiz", [1, 2])).toThrow(
      "Missing answers",
    );
  });

  it("extracts state and counts attempts for one actor and SHA", () => {
    const sha = "b".repeat(40);
    expect(extractSealedState("<!-- quiz-gate-state:abc_123-X -->")).toBe(
      "abc_123-X",
    );
    expect(
      countAttempts(
        [
          {
            body: `<!-- quiz-gate:attempt-v1 sha=${sha} actor=octo result=failed -->`,
            user: { login: "github-actions[bot]" },
          },
          {
            body: `<!-- quiz-gate:attempt-v1 sha=${sha} actor=someone result=failed -->`,
            user: { login: "github-actions[bot]" },
          },
          {
            body: `<!-- quiz-gate:attempt-v1 sha=${sha} actor=octo result=failed -->`,
            user: { login: "attacker" },
          },
        ],
        sha,
        "octo",
      ),
    ).toBe(1);
  });

  it("trusts only passing markers authored by GitHub Actions", () => {
    const sha = "c".repeat(40);
    const forged = {
      body: `<!-- quiz-gate:attempt-v1 sha=${sha} actor=octo result=passed -->`,
      user: { login: "attacker" },
    };
    expect(hasPassingResult([forged], sha)).toBe(false);
    expect(
      hasPassingResult(
        [{ ...forged, user: { login: "github-actions[bot]" } }],
        sha,
      ),
    ).toBe(true);
  });

  it("neutralizes mentions and HTML emitted by an untrusted model", () => {
    const body = renderQuizComment({
      quiz: {
        title: "@all <img>",
        questions: [
          {
            id: 1,
            prompt: "Ping @team?",
            choices: [
              { label: "A", text: "<script>" },
              { label: "B", text: "safe" },
              { label: "C", text: "safe" },
              { label: "D", text: "safe" },
            ],
            correct_option: "B",
            rationale: "safe",
          },
        ],
      },
      state: {
        version: 1,
        repository_id: "1",
        pr_number: 1,
        head_sha: "d".repeat(40),
        created_at: "2026-09-08T00:00:00.000Z",
        threshold: 80,
        answer_command: "/quiz",
        questions: [{ id: 1, correct_option: "B" }],
      },
      sealedState: "sealed",
      provider: "safe",
    });
    expect(body).not.toContain("@all");
    expect(body).not.toContain("<img>");
    expect(body).toContain("&#64;all");
    expect(body).toContain("&lt;script&gt;");
  });
});
