import { z } from "zod";

export const choiceSchema = z.object({
  label: z.enum(["A", "B", "C", "D"]),
  text: z.string().trim().min(1).max(300),
});

export const questionSchema = z.object({
  id: z.number().int().positive(),
  prompt: z.string().trim().min(1).max(600),
  choices: z.array(choiceSchema).length(4),
  correct_option: z.enum(["A", "B", "C", "D"]),
  rationale: z.string().trim().min(1).max(1_000),
});

export const generatedQuizSchema = z.object({
  title: z.string().trim().min(1).max(160),
  questions: z.array(questionSchema).min(1).max(20),
});

export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;

export const attestationSchema = z
  .object({
    version: z.literal(1),
    repository: z.string().regex(/^[^/]+\/[^/]+$/),
    repository_id: z.string().regex(/^\d+$/),
    pr_number: z.number().int().positive(),
    head_sha: z.string().regex(/^[0-9a-f]{40}$/),
    status: z.enum(["in_progress", "completed"]),
    conclusion: z
      .enum(["success", "failure", "neutral", "action_required"])
      .optional(),
    score: z.number().int().min(0).max(100).optional(),
    threshold: z.number().min(0).max(100).optional(),
    actor: z.string().min(1).max(100).optional(),
    run_id: z.string().regex(/^\d+$/),
  })
  .superRefine((value, context) => {
    if (value.status === "completed" && !value.conclusion) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "A completed attestation requires a conclusion",
      });
    }
    if (value.status === "in_progress" && value.conclusion) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "An in-progress attestation cannot have a conclusion",
      });
    }
  });

export type GateAttestation = z.infer<typeof attestationSchema>;
