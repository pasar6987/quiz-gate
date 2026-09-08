import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { workflowTemplate } from "../src/server/templates.js";

describe("installed workflow", () => {
  it("never checks out pull-request code and grants only necessary workflow permissions", () => {
    const workflow = workflowTemplate({
      attestationUrl: "https://quiz-gate.example/github/attest",
      audience: "quiz-gate",
    });
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("github.base_ref");
    expect(workflow).not.toContain("github.event.pull_request.head");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).not.toContain("pull-requests: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("Start Quiz Gate check");
    expect(workflow).toContain("https://quiz-gate.example/github/attest");
    expect(workflow).toContain("-X POST");
    expect(workflow).toContain("status: \"in_progress\"");
    expect(() => parse(workflow)).not.toThrow();
  });
});
