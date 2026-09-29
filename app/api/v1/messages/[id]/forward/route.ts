/**
 * POST /api/v1/messages/[id]/forward — encaminha a mensagem para até 5 conversas.
 *
 * Corpo: `{ conversation_ids: string[] }`. Resposta: um resultado por destino
 * (`ok`, `message_id`, `erro`), porque o encaminhamento é parcial por natureza —
 * um grupo pode aceitar e um contato bloqueado recusar no mesmo gesto.
 *
 * Cada destino é um envio comum pelo `sendMessageHandler` (ver
 * `lib/messaging/encaminhar.ts`): mesmas travas, mesmo registro, mesmo silêncio
 * da IA depois de uma mensagem humana. Mídia é copiada no bucket para a pasta
 * do destino antes do envio.
 *
 * Só sessão de navegador (agent+): encaminhar é gesto de quem atende. Por token
 * seria uma porta de disparo em massa sem o freio de ritmo de `/api/v1/messages`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  caminhoDaCopia,
  encaminharSchema,
  motivoParaNaoEncaminhar,
  type TipoEncaminhavel,
} from "@/lib/messaging/encaminhar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { sendMessageHandler } from "../../_handler";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

interface Resultado {
  conversation_id: string;
  ok: boolean;
  message_id: string | null;
  erro: string | null;
}

const MOTIVOS: Record<string, string> = {
  apagada: "Esta mensagem foi apagada e não pode ser encaminhada.",
  tipo: "Este tipo de mensagem não pode ser encaminhado.",
  midia_pendente: "O arquivo desta mensagem ainda está sendo baixado. Tente de novo em instantes.",
  vazia: "Esta mensagem não tem conteúdo para encaminhar.",
};

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }
  const parsed = encaminharSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha de 1 a 5 conversas diferentes."), 422, { requestId });
  }

  const supabase = await createClient();
  // RLS (só o que quem encaminha enxerga) + filtro explícito da org.
  const { data: origem, error } = await supabase.from("messages")
    .select("id, conversation_id, type, body, media_storage_path, media_mime, media_size_bytes, revoked_at")
    .eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) return fail("internal_error", t("Erro ao buscar mensagem."), 500, { requestId });
  if (!origem) return fail("not_found", t("Mensagem não encontrada."), 404, { requestId });

  const motivo = motivoParaNaoEncaminhar(origem);
  if (motivo) return fail("not_forwardable", t(MOTIVOS[motivo]!), 422, { requestId });

  const temMidia = origem.type !== "text";
  const admin = temMidia ? createAdminClient() : null;
  const handlerCtx = {
    organization_id: orgId,
    actor: { type: "user" as const, id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };

  const resultados: Resultado[] = [];
  // Em sequência, não em paralelo: é o mesmo número de WhatsApp disparando, e
  // rajada simultânea é o padrão que o anti-spam do WhatsApp pune.
  for (const destino of parsed.data.conversation_ids) {
    try {
      let copia: string | undefined;
      if (temMidia && admin && origem.media_storage_path) {
        // Antes de escrever no bucket: a conversa existe, é desta org e quem
        // encaminha a enxerga. O envio confere de novo — aqui é para não deixar
        // arquivo órfão numa pasta que não deveria receber nada.
        const { data: conv } = await supabase.from("conversations").select("id")
          .eq("id", destino).eq("organization_id", orgId).maybeSingle();
        if (!conv) {
          resultados.push({ conversation_id: destino, ok: false, message_id: null, erro: t("Conversa não encontrada.") });
          continue;
        }
        copia = caminhoDaCopia(orgId, destino, origem.type, origem.media_storage_path, randomUUID(), origem.media_mime);
        const { error: copyErr } = await admin.storage.from("whatsapp-media").copy(origem.media_storage_path, copia);
        if (copyErr) {
          console.error("[messages.forward] storage copy failed", copyErr.message);
          resultados.push({ conversation_id: destino, ok: false, message_id: null, erro: t("Não foi possível copiar o arquivo.") });
          continue;
        }
      }

      const enviada = await sendMessageHandler(supabase, handlerCtx, {
        conversation_id: destino,
        type: origem.type as TipoEncaminhavel,
        body: origem.body?.trim() ? origem.body : undefined,
        media_storage_path: copia,
        media_mime: copia ? (origem.media_mime ?? undefined) : undefined,
        media_size_bytes: copia ? (origem.media_size_bytes ?? undefined) : undefined,
        metadata: { forwarded_from_message_id: origem.id },
      });
      const falhou = enviada.status === "failed";
      resultados.push({
        conversation_id: destino,
        ok: !falhou,
        message_id: enviada.id,
        erro: falhou ? (enviada.error_message ?? t("O WhatsApp recusou o envio.")) : null,
      });
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("[messages.forward] send failed", err);
      resultados.push({
        conversation_id: destino,
        ok: false,
        message_id: null,
        erro: err instanceof ApiError && err.message !== err.code ? err.message : t("Não foi possível encaminhar."),
      });
    }
  }

  await audit({
    action: "message.forwarded",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "message",
    resourceId: origem.id,
    requestId,
    metadata: {
      conversation_id: origem.conversation_id,
      destinos: resultados.length,
      enviados: resultados.filter((r) => r.ok).length,
    },
  });

  return ok({ resultados }, { requestId });
}
