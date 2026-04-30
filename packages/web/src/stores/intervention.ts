import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { InterventionRequest, InterventionDecision } from "../types/index.js";

export const useInterventionStore = defineStore("intervention", () => {
  const pendingInterventions = ref<InterventionRequest[]>([]);
  const nextIntervention = computed(() => pendingInterventions.value[0] ?? null);

  function addIntervention(request: InterventionRequest) {
    pendingInterventions.value.push(request);
  }

  function resolveIntervention(requestId: string, decision: InterventionDecision): InterventionDecision | null {
    const idx = pendingInterventions.value.findIndex((i) => i.requestId === requestId);
    if (idx === -1) return null;

    pendingInterventions.value.splice(idx, 1);
    return decision;
  }

  function clearAll() {
    pendingInterventions.value = [];
  }

  return { pendingInterventions, nextIntervention, addIntervention, resolveIntervention, clearAll };
});
