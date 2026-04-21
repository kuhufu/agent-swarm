import { defineStore } from "pinia";
import { ref } from "vue";
import type { InterventionRequest, InterventionDecision, InterventionAction } from "../types/index.js";

export const useInterventionStore = defineStore("intervention", () => {
  const pendingInterventions = ref<InterventionRequest[]>([]);
  const currentIntervention = ref<InterventionRequest | null>(null);

  function addIntervention(request: InterventionRequest) {
    pendingInterventions.value.push(request);
    if (!currentIntervention.value) {
      currentIntervention.value = request;
    }
  }

  function resolveIntervention(requestId: string, decision: InterventionDecision): InterventionDecision | null {
    const idx = pendingInterventions.value.findIndex((i) => i.requestId === requestId);
    if (idx === -1) return null;

    pendingInterventions.value.splice(idx, 1);
    if (currentIntervention.value?.requestId === requestId) {
      currentIntervention.value = pendingInterventions.value[0] ?? null;
    }
    return decision;
  }

  function clearAll() {
    pendingInterventions.value = [];
    currentIntervention.value = null;
  }

  return { pendingInterventions, currentIntervention, addIntervention, resolveIntervention, clearAll };
});
