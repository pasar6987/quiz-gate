import { describe, expect, it } from "vitest";
import { parseQuizGateConfig } from "../src/shared/config.js";

describe("parseQuizGateConfig", () => {
  it("provides a usable privacy-first default", () => {
    const config = parseQuizGateConfig();
    expect(config.provider.kind).toBe("openai");
    expect(config.quiz.question_count).toBe(5);
    expect(config.quiz.pass_threshold).toBe(80);
    expect(config.quiz.answerers).toBe("author");
  });

  it("accepts a repository-defined Sakana connector", () => {
    const config = parseQuizGateConfig(`
provider:
  kind: sakana
  model: fugu
  api: chat
  base_url: https://api.sakana.example/v1
quiz:
  question_count: 7
  pass_threshold: 86
  instructions: Focus on rollback and data migration risks.
`);
    expect(config.provider).toMatchObject({
      kind: "sakana",
      model: "fugu",
      api: "chat",
      base_url: "https://api.sakana.example/v1",
    });
    expect(config.quiz.question_count).toBe(7);
    expect(config.quiz.pass_threshold).toBe(86);
  });

  it("rejects an unbounded question count", () => {
    expect(() => parseQuizGateConfig("quiz:\n  question_count: 200")).toThrow();
  });
});
