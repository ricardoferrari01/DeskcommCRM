import { describe, expect, it } from "vitest";
import { textoDePagamento } from "./pagamento";

const msgPix = (extra: Record<string, unknown> = {}, chave = "12345678000199", tipo = "CNPJ") => ({
  messageContextInfo: {},
  interactiveMessage: {
    nativeFlowMessage: {
      buttons: [
        {
          name: "payment_info",
          buttonParamsJson: JSON.stringify({
            currency: "BRL",
            total_amount: { value: 0, offset: 100 },
            payment_settings: [
              { type: "pix_static_code", pix_static_code: { merchant_name: "SRS Digital", key: chave, key_type: tipo } },
            ],
            ...extra,
          }),
        },
      ],
    },
  },
});

describe("textoDePagamento", () => {
  it("lê a chave Pix do botão do WhatsApp Business", () => {
    expect(textoDePagamento(msgPix())).toBe("Chave Pix (CNPJ): 12345678000199\nRecebedor: SRS Digital");
  });
  it("inclui o valor quando há", () => {
    expect(textoDePagamento(msgPix({ total_amount: { value: 12550, offset: 100 } }))).toContain("Valor: R$");
    expect(textoDePagamento(msgPix({ total_amount: { value: 12550, offset: 100 } }))).toContain("125,50");
  });
  it("tipo de chave desconhecido não quebra", () => {
    expect(textoDePagamento(msgPix({}, "abc", "XYZ"))).toBe("Chave Pix: abc\nRecebedor: SRS Digital");
  });
  it("chave aleatória e e-mail ganham rótulo", () => {
    expect(textoDePagamento(msgPix({}, "x@y.com", "EMAIL"))).toContain("(e-mail)");
    expect(textoDePagamento(msgPix({}, "1b2c", "EVP"))).toContain("(chave aleatória)");
  });
  it("pagamento sem chave legível vira aviso genérico", () => {
    expect(textoDePagamento(msgPix({ payment_settings: [] }))).toBe("Solicitação de pagamento enviada pelo WhatsApp");
  });
  it("JSON quebrado não lança", () => {
    const m = msgPix() as any;
    m.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson = "{nao-json";
    expect(textoDePagamento(m)).toBe("Solicitação de pagamento enviada pelo WhatsApp");
  });
  it("outras mensagens devolvem null", () => {
    expect(textoDePagamento(null)).toBeNull();
    expect(textoDePagamento("x")).toBeNull();
    expect(textoDePagamento({ conversation: "oi" })).toBeNull();
    expect(textoDePagamento({ interactiveMessage: { nativeFlowMessage: { buttons: [{ name: "cta_url" }] } } })).toBeNull();
  });
});
