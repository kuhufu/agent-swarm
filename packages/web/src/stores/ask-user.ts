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
  const currentIndex = ref(0);

  const hasPending = computed(() => pendingRequests.value.length > 0);
  const pendingCount = computed(() => pendingRequests.value.length);
  const nextRequest = computed(() => {
    if (pendingRequests.value.length === 0) return null;
    const idx = Math.min(currentIndex.value, pendingRequests.value.length - 1);
    return pendingRequests.value[idx] ?? null;
  });
  const hasNewer = computed(() => currentIndex.value > 0);
  const hasOlder = computed(() => currentIndex.value < pendingRequests.value.length - 1);

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
        resolveRequest(requestId, { answer: "" }, true);
      }, ASK_USER_TIMEOUT_MS);

      pendingRequests.value.unshift({
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

      currentIndex.value = 0;
    });
  }

  function goTo(index: number) {
    if (index < 0 || index >= pendingRequests.value.length) return;
    currentIndex.value = index;
  }

  function goNext() {
    if (currentIndex.value < pendingRequests.value.length - 1) {
      currentIndex.value++;
    }
  }

  function goPrev() {
    if (currentIndex.value > 0) {
      currentIndex.value--;
    }
  }

  function submitAnswer(requestId: string, answer: string) {
    const request = pendingRequests.value.find((item) => item.requestId === requestId);
    const normalizedAnswer = answer.trim();
    if (request?.multiple && request.choices.length > 0) {
      const lines = normalizedAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
      resolveRequest(requestId, {
        answer: normalizedAnswer,
        selectedChoices: request.choices.filter((choice) => lines.includes(choice)),
        freeText: lines.filter((line) => !request.choices.includes(line)).join("\n"),
      }, false);
      return;
    }
    resolveRequest(requestId, { answer: normalizedAnswer }, false);
  }

  function submitStructuredAnswer(requestId: string, payload: { selectedChoices?: string[]; freeText?: string }) {
    const selectedChoices = normalizeChoices(payload.selectedChoices);
    const freeText = payload.freeText?.trim() ?? "";
    resolveRequest(requestId, {
      answer: [...selectedChoices, ...(freeText ? [freeText] : [])].join("\n"),
      selectedChoices,
      freeText,
    }, false);
  }

  function skip(requestId: string) {
    resolveRequest(requestId, { answer: "" }, true);
  }

  function resolveRequest(
    requestId: string,
    payload: { answer: string; selectedChoices?: string[]; freeText?: string },
    skipped: boolean,
  ) {
    const index = pendingRequests.value.findIndex((item) => item.requestId === requestId);
    if (index === -1) return;
    const request = pendingRequests.value[index];

    clearTimeout(request.timeout);
    pendingRequests.value = pendingRequests.value.filter((item) => item.requestId !== requestId);

    if (currentIndex.value >= pendingRequests.value.length && pendingRequests.value.length > 0) {
      currentIndex.value = pendingRequests.value.length - 1;
    }

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
      const selectedChoices = (payload.selectedChoices ?? [])
        .filter((choice) => request.choices.includes(choice));
      const freeText = payload.freeText?.trim() ?? "";

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
          answer: payload.answer,
          selectedChoices,
          freeText: freeText || undefined,
        },
      });
      return;
    }

    request.resolve({
      isError: false,
      content: `用户回答:\n${payload.answer}`,
      details: {
        question: request.question,
        answer: payload.answer,
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
    ));
  }

  return {
    pendingRequests,
    hasPending,
    pendingCount,
    currentIndex,
    nextRequest,
    hasNewer,
    hasOlder,
    requestAnswer,
    submitAnswer,
    submitStructuredAnswer,
    skip,
    goTo,
    goNext,
    goPrev,
  };
});
