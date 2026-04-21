import { defineStore } from "pinia";
import { ref } from "vue";
import type { InterventionRequest } from "../types/index.js";

export const useInterventionStore = defineStore("intervention", () => {
  const pendingInterventions = ref<InterventionRequest[]>([]);
  const currentIntervention = ref<InterventionRequest | null>(null);

  function addIntervention(request: InterventionRequest) {
    pendingInterventions.value.push(request);
    if (!currentIntervention.value) {
      currentIntervention.value = request;
    }
  }

  function resolveIntervention(requestId: string, decision: any) {
    pendingInterventions.value = pendingInterventions.value.filter(
      (i) => i.requestId !== requestId,
    );
    if (currentIntervention.value?.requestId === requestId) {
      currentIntervention.value = pendingInterventions.value[0] ?? null;
    }
    return decision;
  }

  return { pendingInterventions, currentIntervention, addIntervention, resolveIntervention };
});
