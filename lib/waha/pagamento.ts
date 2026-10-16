/**
 * Pedido de pagamento / chave Pix enviado pelo botão do WhatsApp Business.
 *
 * Esse envio chega como mensagem INTERATIVA, e não como texto: `payload.body` vem
 * vazio e o conteúdo está em
 * `_data.message.interactiveMessage.nativeFlowMessage.buttons[]`, no botão
 * `payment_info`, cujo `buttonParamsJson` é um TEXTO com um JSON dentro
 * (`payment_settings[].pix_static_code = { merchant_name, key, key_type }`).
 *
 * Sem ler isso o ingest não achava texto nem mídia e descartava o evento em
 * silêncio. Aqui o cartão vira um texto legível para a conversa.
 */

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const ROTULO_DA_CHAVE: Record<string, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  PHONE: "telefone",
  EMAIL: "e-mail",
  EVP: "chave aleatória",
};

function valorEmReais(total: unknown): string | null {
  const t = obj(total);
  const valor = typeof t?.value === "number" ? t.value : null;
  const escala = typeof t?.offset === "number" && t.offset > 0 ? t.offset : 100;
  if (valor === null || valor <= 0) return null;
  return (valor / escala).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Texto da mensagem de pagamento, ou null se `msg` não for uma. */
export function textoDePagamento(msg: unknown): string | null {
  const m = obj(msg);
  const fluxo = obj(obj(m?.interactiveMessage)?.nativeFlowMessage);
  const botoes = Array.isArray(fluxo?.buttons) ? fluxo.buttons : [];
  for (const b of botoes) {
    const botao = obj(b);
    if (botao?.name !== "payment_info") continue;

    let params: Record<string, unknown> | null = null;
    try {
      params = obj(JSON.parse(String(botao.buttonParamsJson ?? "")));
    } catch {
      params = null;
    }

    const configuracoes = Array.isArray(params?.payment_settings) ? params.payment_settings : [];
    for (const c of configuracoes) {
      const pix = obj(obj(c)?.pix_static_code);
      const chave = typeof pix?.key === "string" ? pix.key.trim() : "";
      if (!chave) continue;
      const tipo = typeof pix?.key_type === "string" ? pix.key_type.trim().toUpperCase() : "";
      const rotulo = ROTULO_DA_CHAVE[tipo];
      const recebedor = typeof pix?.merchant_name === "string" ? pix.merchant_name.trim() : "";
      const valor = valorEmReais(params?.total_amount);
      const linhas = [`Chave Pix${rotulo ? ` (${rotulo})` : ""}: ${chave}`];
      if (recebedor) linhas.push(`Recebedor: ${recebedor}`);
      if (valor) linhas.push(`Valor: ${valor}`);
      return linhas.join("\n");
    }
    // Botão de pagamento sem chave legível (outro meio de pagamento): ainda assim
    // a mensagem existe e não deve sumir da conversa.
    return "Solicitação de pagamento enviada pelo WhatsApp";
  }
  return null;
}
