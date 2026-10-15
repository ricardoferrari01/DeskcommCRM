/**
 * Nome do documento que chegou pelo WAHA. O NOWEB entrega o nome em
 * `payload.media.filename`; o conteúdo cru traz `documentMessage.fileName`
 * (ou `title`). Imagens, vídeos e áudios não têm nome — devolve `{}` e nada muda.
 */
import { limparNomeDeArquivo } from "@/lib/messaging/nome-do-arquivo";

import type { WahaPayload } from "./envelope";

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function metadadosDeArquivo(p: WahaPayload): Record<string, unknown> {
  const doc = obj(obj(p._data?.message)?.["documentMessage"]);
  const nome =
    limparNomeDeArquivo(obj(p.media)?.["filename"]) ??
    limparNomeDeArquivo(doc?.["fileName"]) ??
    limparNomeDeArquivo(doc?.["title"]);
  return nome ? { filename: nome } : {};
}
