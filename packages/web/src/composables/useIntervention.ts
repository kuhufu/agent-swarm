import { computed } from "vue";
import { useInterventionStore } from "../stores/intervention.js";
import { useWebSocket } from "./useWebSocket.js";
import type { InterventionAction } from "../types/index.js";

export function useIntervention() {
  const interventionStore = useInterventionStore();
  const { send } = useWebSocket();

  const hasPending = computed(() => interventionStore.pendingInterventions.length > 0);
  const currentIntervention = computed(() => interventionStore.currentIntervention);

  function submitDecision(requestId: string, action: InterventionAction, editedInput?: string, reason?: string) {
    const decision = interventionStore.resolveIntervention(requestId, { action, editedInput, reason });

    send({
      type: "intervention_decision",
      payload: { requestId, decision },
    });
  }

  function approve(requestId: string) {
    submitDecision(requestId, "approve");
  }

  function reject(requestId: string, reason?: string) {
    submitDecision(requestId, "reject", undefined, reason);
  }

  function edit(requestId: string, editedInput: string) {
    submitDecision(requestId, "edit", editedInput);
  }

  function abort(requestId: string) {
    submitDecision(requestId, "abort");
  }

  return { hasPending, currentIntervention, approve, reject, edit, abort };
}
