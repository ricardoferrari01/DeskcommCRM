/**
 * Encaminhar uma mensagem para outras conversas (contatos ou grupos), como o
 * "Encaminhar" do WhatsApp.
 *
 * O encaminhamento NÃO usa o forward nativo do canal: reenvia o conteúdo pela
 * mesma porta de saída de todo envio (`sendMessageHandler`). Assim ele vale em
 * qualquer engine/canal, herda todas as travas do envio (contato bloqueado,
 * janela de 24h, canal arquivado, silêncio da IA após resposta humana) e a
 * mensagem chega sem a etiqueta "Encaminhada" — é o atendente quem manda.
 *
 * Mídia: o envio só aceita `media_storage_path` DENTRO da pasta da conversa de
 * destino (`isMediaPathOwnedBy`). Por isso o arquivo é copiado no bucket para
 * a pasta de cada destino antes do envio — nunca se aponta o destino para o
 * arquivo de outra conversa.
 */
import { z } from "zod";

import { extFromMime } from "@/lib/messaging/media/types";

/** Tipos que dá para reenviar fielmente. Figurinha sairia como arquivo; cartão, local e modelo têm regra própria. */
export const TIPOS_ENCAMINHAVEIS = ["text", "image", "video", "audio", "document"] as const;
export type TipoEncaminhavel = (typeof TIPOS_ENCAMINHAVEIS)[number];

/** Mesmo limite do WhatsApp: encaminhar para até 5 conversas de uma vez. */
export const MAX_DESTINOS = 5;

export const encaminharSchema = z.object({
  conversation_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_DESTINOS)
    .refine((ids) => new Set(ids).size === ids.length, { message: "conversa repetida" }),
});
export type EncaminharInput = z.infer<typeof encaminharSchema>;

export interface MensagemEncaminhavel {
  type: string;
  body: string | null;
  media_storage_path: string | null;
  revoked_at: string | null;
}

export type MotivoParaNaoEncaminhar = "apagada" | "tipo" | "midia_pendente" | "vazia";

/** `null` quando a mensagem pode ser encaminhada; senão, o porquê. */
export function motivoParaNaoEncaminhar(m: MensagemEncaminhavel): MotivoParaNaoEncaminhar | null {
  if (m.revoked_at) return "apagada";
  if (!(TIPOS_ENCAMINHAVEIS as readonly string[]).includes(m.type)) return "tipo";
  if (m.type === "text") return m.body && m.body.trim() ? null : "vazia";
  // Mídia recebida só pode ser reenviada depois que o worker a guardou no bucket.
  return m.media_storage_path ? null : "midia_pendente";
}

const NOME_DO_ARQUIVO: Record<Exclude<TipoEncaminhavel, "text">, string> = {
  image: "imagem",
  video: "video",
  audio: "audio",
  document: "documento",
};

/**
 * Onde a cópia do arquivo mora na conversa de destino. A última parte do
 * caminho vira o nome do arquivo que o cliente vê (o envio usa
 * `split("/").pop()`), por isso a subpasta única e um nome legível.
 */
export function caminhoDaCopia(
  orgId: string,
  conversaDestino: string,
  tipo: string,
  caminhoOrigem: string,
  id: string,
  mime?: string | null,
): string {
  const ultima = caminhoOrigem.split("/").pop() ?? "";
  const extOrigem = ultima.includes(".") ? ultima.split(".").pop()!.toLowerCase() : "";
  const ext = /^[a-z0-9]{1,8}$/.test(extOrigem) ? extOrigem : extFromMime(mime ?? "");
  const nome = NOME_DO_ARQUIVO[tipo as Exclude<TipoEncaminhavel, "text">] ?? "arquivo";
  return `${orgId}/${conversaDestino}/fwd-${id}/${nome}.${ext}`;
}
