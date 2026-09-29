"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface ResultadoDoEncaminhamento {
  conversation_id: string;
  ok: boolean;
  message_id: string | null;
  erro: string | null;
}

interface Args {
  messageId: string;
  conversationIds: string[];
}

/** Encaminha uma mensagem para até 5 conversas. O resultado vem por destino. */
export function useForwardMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, conversationIds }: Args) =>
      apiClient.post<{ data: { resultados: ResultadoDoEncaminhamento[] } }>(
        `/api/v1/messages/${messageId}/forward`,
        { conversation_ids: conversationIds },
      ),
    onError: (err) => showApiError(err),
    onSettled: (_data, _err, args) => {
      for (const id of args.conversationIds) qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
