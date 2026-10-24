/**
 * Texto de mensagens "comerciais" do WhatsApp (de empresas): template com
 * botões, mensagem interativa, botões simples e lista.
 *
 * O WAHA entrega `body: null` nesses formatos — o texto, o rodapé e os botões
 * (inclusive o LINK de pagamento) ficam escondidos dentro de `_data.message`.
 * Sem esta leitura o CRM mostrava só a imagem, ou nada.
 *
 * Devolve `null` quando a mensagem não é de nenhum desses formatos.
 */
type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const ENVOLTORIOS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
];

function desembrulhar(msg: unknown): Obj | null {
  let atual = obj(msg);
  for (let i = 0; i < 4 && atual; i++) {
    const base: Obj = atual;
    const interno = ENVOLTORIOS.map((k) => obj(obj(base[k])?.message)).find(
      (x): x is Obj => x !== null,
    );
    if (!interno) break;
    atual = interno;
  }
  return atual;
}

function linhaDeBotao(rotulo: string, valor: string): string {
  if (rotulo && valor) return `${rotulo}: ${valor}`;
  return rotulo || valor;
}

function juntar(partes: string[], botoes: string[]): string | null {
  const blocos = partes.filter(Boolean);
  const linhas = botoes.filter(Boolean);
  if (linhas.length) blocos.push(linhas.join("\n"));
  return blocos.length ? blocos.join("\n\n") : null;
}

function doTemplate(m: Obj): string | null {
  const t = obj(obj(m.templateMessage)?.hydratedTemplate);
  if (!t) return null;
  const botoes: string[] = [];
  if (Array.isArray(t.hydratedButtons)) {
    for (const item of t.hydratedButtons) {
      const b = obj(item);
      if (!b) continue;
      const url = obj(b.urlButton);
      const call = obj(b.callButton);
      const rapido = obj(b.quickReplyButton);
      if (url) botoes.push(linhaDeBotao(txt(url.displayText), txt(url.url)));
      else if (call) botoes.push(linhaDeBotao(txt(call.displayText), txt(call.phoneNumber)));
      else if (rapido) botoes.push(txt(rapido.displayText));
    }
  }
  return juntar(
    [txt(t.hydratedTitleText), txt(t.hydratedContentText), txt(t.hydratedFooterText)],
    botoes,
  );
}

function doInterativo(m: Obj): string | null {
  const i = obj(m.interactiveMessage);
  if (!i) return null;
  const botoes: string[] = [];
  const fluxo = obj(i.nativeFlowMessage);
  if (fluxo && Array.isArray(fluxo.buttons)) {
    for (const item of fluxo.buttons) {
      const b = obj(item);
      if (!b || typeof b.buttonParamsJson !== "string") continue;
      let p: Obj | null = null;
      try {
        p = obj(JSON.parse(b.buttonParamsJson));
      } catch {
        p = null;
      }
      if (!p) continue;
      const nome = txt(b.name);
      if (nome === "cta_url") botoes.push(linhaDeBotao(txt(p.display_text), txt(p.url)));
      else if (nome === "cta_copy") {
        botoes.push(linhaDeBotao(txt(p.display_text) || "Código", txt(p.copy_code)));
      } else if (nome === "cta_call") {
        botoes.push(linhaDeBotao(txt(p.display_text), txt(p.phone_number)));
      } else if (nome === "quick_reply") botoes.push(txt(p.display_text));
    }
  }
  const cabecalho = obj(i.header);
  return juntar(
    [
      txt(cabecalho?.title),
      txt(obj(i.body)?.text),
      txt(obj(i.footer)?.text),
    ],
    botoes,
  );
}

function dosBotoes(m: Obj): string | null {
  const b = obj(m.buttonsMessage);
  if (!b) return null;
  const botoes: string[] = [];
  if (Array.isArray(b.buttons)) {
    for (const item of b.buttons) {
      botoes.push(txt(obj(obj(item)?.buttonText)?.displayText));
    }
  }
  return juntar([txt(b.contentText), txt(b.footerText)], botoes);
}

function daLista(m: Obj): string | null {
  const l = obj(m.listMessage);
  if (!l) return null;
  const linhas: string[] = [];
  if (Array.isArray(l.sections)) {
    for (const sec of l.sections) {
      const rows = obj(sec)?.rows;
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const t = txt(obj(r)?.title);
        if (t && linhas.length < 12) linhas.push(`• ${t}`);
      }
    }
  }
  return juntar([txt(l.title), txt(l.description), txt(l.footerText)], linhas);
}

export function textoDeMensagemComercial(msg: unknown): string | null {
  const m = desembrulhar(msg);
  if (!m) return null;
  return doTemplate(m) ?? doInterativo(m) ?? dosBotoes(m) ?? daLista(m);
}
