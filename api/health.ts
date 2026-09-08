import { configurationStatus } from "../src/server/env.js";
import { json } from "../src/server/http.js";
import { bundleVersion } from "../src/server/templates.js";

export function GET(): Response {
  const configured = configurationStatus();
  return json({
    ok: true,
    service: "quiz-gate",
    version: bundleVersion,
    configured,
    ready: Object.values(configured).every(Boolean),
    privacy: {
      database: false,
      receives_source_diff: false,
      receives_provider_key: false,
      stores_quiz_answers: false,
    },
  });
}
