import { describe, expect, it } from "vitest";
import { openQuizState, sealQuizState, type QuizState } from "../src/action/state.js";

const state: QuizState = {
  version: 1,
  repository_id: "42",
  pr_number: 7,
  head_sha: "a".repeat(40),
  created_at: "2026-09-08T00:00:00.000Z",
  threshold: 80,
  answer_command: "/quiz",
  questions: [
    {
      id: 1,
      correct_option: "B",
    },
  ],
};

describe("encrypted quiz state", () => {
  it("round-trips without server storage", () => {
    const sealed = sealQuizState(state, "provider-secret");
    expect(sealed).not.toContain("correct_option");
    expect(openQuizState(sealed, "provider-secret", "42")).toEqual(state);
  });

  it("is bound to the repository and credential", () => {
    const sealed = sealQuizState(state, "provider-secret");
    expect(() => openQuizState(sealed, "other-secret", "42")).toThrow();
    expect(() => openQuizState(sealed, "provider-secret", "43")).toThrow();
  });
});
