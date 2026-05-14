import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface AskUserParams {
  question: string;
  context?: string;
  choices?: string[];
  defaultAnswer?: string;
  multiple?: boolean;
}

export interface AskUserResult {
  isError: boolean;
  content: string;
  details?: {
    question: string;
    answer: string;
    selectedChoices?: string[];
    freeText?: string;
    skipped?: boolean;
  };
}

interface AskUserRequest {
  requestId: string;
  createdAt: number;
  question: string;
  context: string | undefined;
  choices: string[];
  defaultAnswer: string | undefined;
  multiple: boolean;
  resolve: (result: AskUserResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const ASK_USER_TIMEOUT_MS = 10 * 60 * 1000;

export const useAskUserStore = defineStore("askUser", () => {
  const pendingRequests = ref<AskUserRequest[]>([]);

  const hasPending = computed(() => pendingRequests.value.length > 0);
  const nextRequest = computed(() => pendingRequests.value[0] ?? null);

  function requestAnswer(params: AskUserParams): Promise<AskUserResult> {
    const question = params.question.trim();
    if (!question) {
      return Promise.resolve({
        isError: true,
        content: "ask_user 参数错误：question 不能为空",
      });
    }

    return new Promise<AskUserResult>((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        resolveRequest(requestId, "", true);
      }, ASK_USER_TIMEOUT_MS);

      pendingRequests.value.push({
        requestId,
        question,
        context: params.context?.trim() || undefined,
        choices: normalizeChoices(params.choices),
        defaultAnswer: params.defaultAnswer?.trim() || undefined,
        multiple: params.multiple === true,
        createdAt: Date.now(),
        resolve,
        timeout,
      });
    });
  }

  function submitAnswer(requestId: string, answer: string) {
    resolveRequest(requestId, answer.trim(), false);
  }

  function skip(requestId: string) {
    resolveRequest(requestId, "", true);
  }

  function resolveRequest(requestId: string, answer: string, skipped: boolean) {
    const request = pendingRequests.value.find((item) => item.requestId === requestId);
    if (!request) return;

    clearTimeout(request.timeout);
    pendingRequests.value = pendingRequests.value.filter((item) => item.requestId !== requestId);

    if (skipped) {
      request.resolve({
        isError: false,
        content: "用户未提供回答。",
        details: {
          question: request.question,
          answer: "",
          skipped: true,
        },
      });
      return;
    }

    if (request.multiple && request.choices.length > 0) {
      const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);
      const selectedChoices = request.choices.filter((c) => lines.includes(c));
      const otherLines = lines.filter((l) => !request.choices.includes(l));
      const freeText = otherLines.join("\n");

      const parts: string[] = [];
      if (selectedChoices.length > 0) {
        parts.push(`用户选择:\n${selectedChoices.map((c) => `- ${c}`).join("\n")}`);
      }
      if (freeText) {
        parts.push(`用户补充: ${freeText}`);
      }
      if (parts.length === 0) {
        parts.push("用户未选择任何选项。");
      }

      request.resolve({
        isError: false,
        content: parts.join("\n\n"),
        details: {
          question: request.question,
          answer,
          selectedChoices,
          freeText: freeText || undefined,
        },
      });
      return;
    }

    request.resolve({
      isError: false,
      content: `用户回答:\n${answer}`,
      details: {
        question: request.question,
        answer,
      },
    });
  }

  function normalizeChoices(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
      input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )).slice(0, 6);
  }

  return {
    pendingRequests,
    hasPending,
    nextRequest,
    requestAnswer,
    submitAnswer,
    skip,
  };
});
