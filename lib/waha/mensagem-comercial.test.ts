import { describe, expect, it } from "vitest";
import { textoDeMensagemComercial } from "./mensagem-comercial";

const template = {
  templateMessage: {
    hydratedTemplate: {
      imageMessage: {},
      hydratedContentText: "*Você tem pagamentos pendentes*\n\nConfira as opções.",
      hydratedFooterText: "Canal oficial.",
      hydratedButtons: [
        { quickReplyButton: { displayText: "Consultar opções", id: "x" }, index: 0 },
        { urlButton: { displayText: "Pagar agora", url: "https://pagamento.exemplo.com/abc" }, index: 1 },
        { callButton: { displayText: "Ligar", phoneNumber: "+5555999999999" }, index: 2 },
      ],
    },
  },
};

describe("textoDeMensagemComercial", () => {
  it("lê texto, rodapé e botões de um template", () => {
    const t = textoDeMensagemComercial(template);
    expect(t).toContain("Você tem pagamentos pendentes");
    expect(t).toContain("Canal oficial.");
    expect(t).toContain("Consultar opções");
    expect(t).toContain("Pagar agora: https://pagamento.exemplo.com/abc");
    expect(t).toContain("Ligar: +5555999999999");
  });

  it("atravessa o envoltório ephemeralMessage", () => {
    expect(textoDeMensagemComercial({ ephemeralMessage: { message: template } })).toContain(
      "https://pagamento.exemplo.com/abc",
    );
  });

  it("lê botões de link e de copiar código de mensagem interativa", () => {
    const t = textoDeMensagemComercial({
      interactiveMessage: {
        body: { text: "Seu boleto" },
        footer: { text: "Loja X" },
        nativeFlowMessage: {
          buttons: [
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "Pagar", url: "https://pay.exemplo.com/1" }) },
            { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "Copiar código", copy_code: "123456" }) },
          ],
        },
      },
    });
    expect(t).toContain("Seu boleto");
    expect(t).toContain("Pagar: https://pay.exemplo.com/1");
    expect(t).toContain("Copiar código: 123456");
  });

  it("lê mensagem de botões e de lista", () => {
    expect(
      textoDeMensagemComercial({ buttonsMessage: { contentText: "Escolha", buttons: [{ buttonText: { displayText: "Sim" } }] } }),
    ).toBe("Escolha\n\nSim");
    expect(
      textoDeMensagemComercial({ listMessage: { title: "Menu", sections: [{ rows: [{ title: "A" }] }] } }),
    ).toBe("Menu\n\n• A");
  });

  it("ignora JSON de botão inválido sem quebrar", () => {
    expect(
      textoDeMensagemComercial({
        interactiveMessage: { body: { text: "Oi" }, nativeFlowMessage: { buttons: [{ name: "cta_url", buttonParamsJson: "{quebrado" }] } },
      }),
    ).toBe("Oi");
  });

  it("devolve null para o que não é mensagem comercial", () => {
    expect(textoDeMensagemComercial({ conversation: "oi" })).toBeNull();
    expect(textoDeMensagemComercial(null)).toBeNull();
    expect(textoDeMensagemComercial({ templateMessage: { hydratedTemplate: {} } })).toBeNull();
  });
});
