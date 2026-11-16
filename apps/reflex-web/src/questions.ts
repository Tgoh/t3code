import {
  buildPendingUserInputAnswers,
  normalizeSelectedOptionValues,
  type PendingUserInputAnswer,
  type PendingUserInputDraftAnswer,
  resolvePendingUserInputAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { seedUserInputDraftAnswers } from "@t3tools/client-runtime/state/thread-requests";

import type { IWireTurnItem } from "./Infrastructure/wire";

export type IQuestion = Extract<IWireTurnItem, { type: "user_input_request" }>["questions"][number];

export interface IQuestionDraft {
  selectedOptionValues?: string[];
  customAnswer?: string;
}

export interface IQuestionProgress {
  QuestionIndex: number;
  Question: IQuestion | null;
  SelectedOptionValues: ReadonlyArray<string>;
  CustomAnswer: string;
  IsLastQuestion: boolean;
  CanAdvance: boolean;
  Answers: Record<string, PendingUserInputAnswer> | null;
}

/** What the composer needs while it holds the answer to an open question. */
export interface IAnswering {
  progress: () => IQuestionProgress;
  responding: () => boolean;
  canRespond: () => boolean;
  setCustomAnswer: (text: string) => void;
  advance: () => void;
  previous: () => void;
}

/** Suggested answers show until the user edits them; only edits are held. */
export function seededDrafts(
  questions: ReadonlyArray<IQuestion>,
  held: Record<string, IQuestionDraft> | undefined,
): Record<string, PendingUserInputDraftAnswer> {
  return seedUserInputDraftAnswers(questions, held ?? {});
}

// Follows derivePendingUserInputProgress in apps/web/src/pendingUserInput.ts.
export function questionProgress(
  questions: ReadonlyArray<IQuestion>,
  held: Record<string, IQuestionDraft> | undefined,
  questionIndex: number,
): IQuestionProgress {
  const drafts = seededDrafts(questions, held);
  const index =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const question = questions[index] ?? null;
  const draft = question === null ? undefined : drafts[question.id];
  return {
    QuestionIndex: index,
    Question: question,
    SelectedOptionValues:
      question === null ? [] : normalizeSelectedOptionValues(question, draft?.selectedOptionValues),
    CustomAnswer: question?.allowCustomAnswer === false ? "" : (draft?.customAnswer ?? ""),
    IsLastQuestion: index >= questions.length - 1,
    CanAdvance: question !== null && resolvePendingUserInputAnswer(question, draft) !== null,
    Answers: buildPendingUserInputAnswers(questions, drafts),
  };
}

// Follows carryDisplacedCustomAnswerIntoPrompt in apps/web/src/pendingUserInput.ts.
export function carryIntoPrompt(prompt: string, answer: string | undefined): string {
  const displaced = answer?.trim() ?? "";
  if (displaced.length === 0) return prompt;
  if (prompt.trim().length === 0) return displaced;
  return `${prompt.trimEnd()}\n\n${displaced}`;
}

// Follows the composer placeholder in apps/web/src/components/chat/ChatComposer.tsx.
export function answerPlaceholder(question: IQuestion): string {
  if (question.allowCustomAnswer === false) return "Choose an option above";
  return question.options.length === 0
    ? "Type your answer"
    : "Type your own answer, or leave this blank to use the selected option";
}

// Follows formatPendingPrimaryActionLabel in apps/web/src/components/chat/ComposerPrimaryActions.tsx.
export function advanceLabel(progress: IQuestionProgress, responding: boolean): string {
  if (responding) return "Submitting...";
  if (!progress.IsLastQuestion) return "Next question";
  return progress.QuestionIndex > 0 ? "Submit answers" : "Submit answer";
}
