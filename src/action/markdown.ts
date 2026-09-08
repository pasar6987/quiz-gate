import type { GeneratedQuiz } from "../shared/schemas.js";
import type { QuizState } from "./state.js";

export const QUIZ_MARKER = "<!-- quiz-gate:quiz-v1 -->";
const STATE_PATTERN = /<!-- quiz-gate-state:([A-Za-z0-9_-]+) -->/;
const AUTOMATION_LOGIN = "github-actions[bot]";

function escapeInline(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

export function renderQuizComment(input: {
  quiz: GeneratedQuiz;
  state: QuizState;
  sealedState: string;
  provider: string;
}): string {
  const { quiz, state, sealedState, provider } = input;
  const answerExample = state.questions
    .map((question) => `${question.id}:A`)
    .join(" ");
  const questions = quiz.questions
    .map((question) => {
      const choices = question.choices
        .map((choice) => `- **${choice.label}.** ${escapeInline(choice.text)}`)
        .join("\n");
      return `### ${question.id}. ${escapeInline(question.prompt)}\n\n${choices}`;
    })
    .join("\n\n");

  return `${QUIZ_MARKER}
<!-- quiz-gate-sha:${state.head_sha} -->
## 🧠 ${escapeInline(quiz.title)}

이 PR을 병합하려면 아래 퀴즈를 통과해야 합니다.

${questions}

### 답변 방법

새 댓글로 다음 형식의 답을 남겨주세요.

\`${state.answer_command} ${answerExample}\`

- 합격 기준: **${state.threshold}%**
- 출제 모델 연결: **${escapeInline(provider)}**
- 이 퀴즈는 커밋 \`${state.head_sha.slice(0, 7)}\`에 묶여 있습니다.

<sub>정답 데이터는 사용자의 LLM 자격증명에서 파생된 키로 암호화되며 Quiz Gate 서버에는 저장되지 않습니다.</sub>
<!-- quiz-gate-state:${sealedState} -->`;
}

export function extractSealedState(comment: string): string | null {
  return STATE_PATTERN.exec(comment)?.[1] ?? null;
}

export function parseAnswers(
  body: string,
  command: string,
  questionIds: number[],
): Map<number, "A" | "B" | "C" | "D"> {
  const trimmed = body.trim();
  const firstToken = trimmed.split(/\s+/, 1)[0];
  if (firstToken?.toLowerCase() !== command.toLowerCase()) {
    throw new Error(`Answer must start with ${command}.`);
  }
  const answerText = trimmed.slice(command.length).trim();
  const answers = new Map<number, "A" | "B" | "C" | "D">();
  const numberedPattern = /(\d+)\s*[:.)=-]?\s*([A-D])\b/gi;
  for (const match of answerText.matchAll(numberedPattern)) {
    const id = Number(match[1]);
    const option = match[2]?.toUpperCase();
    if (option && /^[A-D]$/.test(option)) {
      answers.set(id, option as "A" | "B" | "C" | "D");
    }
  }

  if (answers.size === 0) {
    const options = answerText.match(/\b[A-D]\b/gi) ?? [];
    if (options.length === questionIds.length) {
      questionIds.forEach((id, index) => {
        answers.set(
          id,
          options[index]!.toUpperCase() as "A" | "B" | "C" | "D",
        );
      });
    }
  }

  const missing = questionIds.filter((id) => !answers.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing answers for question(s): ${missing.join(", ")}.`);
  }
  return answers;
}

export function renderResultComment(input: {
  headSha: string;
  actor: string;
  score: number;
  threshold: number;
  passed: boolean;
  incorrectIds: number[];
  attempt: number;
  maxAttempts: number;
}): string {
  const { headSha, actor, score, threshold, passed, incorrectIds, attempt, maxAttempts } =
    input;
  const result = passed ? "✅ 통과" : "❌ 불합격";
  const incorrect =
    incorrectIds.length > 0
      ? `\n- 다시 확인할 문제: ${incorrectIds.join(", ")}`
      : "";

  return `<!-- quiz-gate:attempt-v1 sha=${headSha} actor=${actor} result=${passed ? "passed" : "failed"} -->
## ${result}: Quiz Gate

- 점수: **${score}%**
- 합격 기준: **${threshold}%**
- 시도: **${attempt}/${maxAttempts}**${incorrect}

${passed ? "현재 커밋의 이해도 검증을 통과했습니다." : "코드 변경 내용을 다시 확인한 뒤 답변을 다시 제출해주세요."}`;
}

export function countAttempts(
  comments: Array<{ body: string; user: { login: string } }>,
  headSha: string,
  actor: string,
): number {
  const marker = `<!-- quiz-gate:attempt-v1 sha=${headSha} actor=${actor} result=`;
  return comments.filter(
    (comment) =>
      isTrustedAutomationComment(comment) && comment.body.includes(marker),
  ).length;
}

export function isTrustedAutomationComment(comment: {
  user: { login: string };
}): boolean {
  return comment.user.login.toLowerCase() === AUTOMATION_LOGIN;
}

export function hasPassingResult(
  comments: Array<{ body: string; user: { login: string } }>,
  headSha: string,
): boolean {
  const marker = `<!-- quiz-gate:attempt-v1 sha=${headSha} actor=`;
  return comments.some(
    (comment) =>
      isTrustedAutomationComment(comment) &&
      comment.body.includes(marker) &&
      comment.body.includes(" result=passed -->"),
  );
}
