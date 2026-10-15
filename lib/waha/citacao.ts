/**
 * Resposta citada ("responder" em cima de uma mensagem no WhatsApp).
 *
 * O WAHA entrega a citação de duas formas, e as duas chegavam e eram jogadas fora
 * (o envelope é `loose`, então o campo passava intacto e ninguém o lia):
 *
 *   1. `payload.replyTo` — `{ id, participant, hasMedia, media, _data }`. O `id`
 *      vem CURTO (`2A75F6…`), enquanto `messages.external_id` guarda o composto
 *      (`false_<chat>_<id>`) para o que chegou pelo webhook e o curto para o que
 *      saiu pelo CRM. Por isso a busca casa pelas duas formas.
 *   2. `payload._data.message.<tipo>.contextInfo.stanzaId` (NOWEB cru).
 *
 * Quando a mensagem citada é um ÁLBUM de fotos, o WhatsApp cita o id do álbum
 * (`replyTo._data.albumMessage`), que não existe em `messages` — cada foto tem o
 * seu. Nesse caso liga-se à foto de imagem mais recente da conversa e marca-se
 * `approximate: true` no metadata, para ninguém tomar o palpite por certeza.
 *
 * Melhor esforço: nunca lança. Citação que não resolve vira só metadata.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WahaPayload } from "./envelope";
import { bareWaMessageId, parseWahaMessageId } from "./message-id";

export interface CitacaoLida {
  /** id da mensagem citada, como o WAHA mandou (curto ou composto) */
  idCitado: string;
  temMidia: boolean | null;
  /** presente quando a citada é um álbum; `imagens` pode ser null se o WAHA não disse */
  album: { imagens: number | null } | null;
  origem: "replyTo" | "contextInfo";
}

export interface CitacaoResolvida {
  replyToMessageId: string | null;
  /** para espalhar em `messages.metadata` — vazio quando a mensagem não cita nada */
  metadata: Record<string, unknown>;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function lerCitacaoWaha(p: WahaPayload): CitacaoLida | null {
  const rt = obj((p as Record<string, unknown>)["replyTo"]);
  if (rt) {
    const id = parseWahaMessageId(rt);
    if (id) {
      const alb = obj(obj(rt["_data"])?.["albumMessage"]);
      const n = alb ? alb["expectedImageCount"] : null;
      return {
        idCitado: id,
        temMidia: typeof rt["hasMedia"] === "boolean" ? rt["hasMedia"] : null,
        album: alb ? { imagens: typeof n === "number" ? n : null } : null,
        origem: "replyTo",
      };
    }
  }
  const msg = obj(p._data?.message);
  if (msg) {
    const candidatos = [obj(msg["contextInfo"]), ...Object.values(msg).map((v) => obj(obj(v)?.["contextInfo"]))];
    for (const ci of candidatos) {
      const sid = str(ci?.["stanzaId"]);
      if (sid) return { idCitado: sid, temMidia: null, album: null, origem: "contextInfo" };
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const VAZIA: CitacaoResolvida = { replyToMessageId: null, metadata: {} };

export async function resolverCitacao(
  admin: Admin,
  organizationId: string,
  conversationId: string,
  p: WahaPayload,
  sentAtIso: string,
  avisar?: (mensagem: string, detalhe: Record<string, unknown>) => void,
): Promise<CitacaoResolvida> {
  try {
    const c = lerCitacaoWaha(p);
    if (!c) return VAZIA;
    const bare = bareWaMessageId(c.idCitado);
    const contexto: Record<string, unknown> = {
      quoted_external_id: c.idCitado,
      has_media: c.temMidia,
      album_images: c.album?.imagens ?? null,
    };
    // Só id alfanumérico entra em filtro — o que vem do fio nunca é concatenado cru.
    if (!/^[A-Za-z0-9]{6,}$/.test(bare)) {
      return { replyToMessageId: null, metadata: { reply_context: { ...contexto, resolved: false } } };
    }

    const chat = str(p.from);
    const candidatos = [...new Set([c.idCitado, bare, ...(chat ? [`true_${chat}_${bare}`, `false_${chat}_${bare}`] : [])])];
    const exato = await admin
      .from("messages")
      .select("id")
      .eq("organization_id", organizationId)
      .in("external_id", candidatos)
      .limit(1)
      .maybeSingle();
    let id: string | null = str((exato.data as { id?: unknown } | null)?.id);
    let aproximado = false;

    if (!id) {
      // O chat pode ter id composto com `@lid` de um lado e `@c.us` do outro: a cauda casa igual.
      const cauda = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .like("external_id", `%${bare}`)
        .limit(1)
        .maybeSingle();
      id = str((cauda.data as { id?: unknown } | null)?.id);
    }
    if (!id && c.album) {
      const foto = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("type", "image")
        .lte("sent_at", sentAtIso)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      id = str((foto.data as { id?: unknown } | null)?.id);
      aproximado = id !== null;
    }
    return {
      replyToMessageId: id,
      metadata: { reply_context: { ...contexto, resolved: id !== null, ...(aproximado ? { approximate: true } : {}) } },
    };
  } catch (err) {
    avisar?.("waha.ingest: citacao nao resolvida (mensagem segue sem ela)", {
      detail: err instanceof Error ? err.message : String(err),
    });
    return VAZIA;
  }
}
