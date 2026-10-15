import { describe, expect, it } from "vitest";

import { separarLinks } from "./separar-links";

const links = (t: string) => separarLinks(t).filter((p) => p.tipo === "link").map((p) => (p.tipo === "link" ? p.href : ""));

describe("separarLinks", () => {
  it("link longo com hífens duplos, barras e query (o do Mercado Livre)", () => {
    const u = "https://www.mercadolivre.com.br/kit-terere-chacal-bomba-cuia-garrafa-25l-inox--lancamento/up/MLBU3568627784?quantity=20";
    expect(separarLinks(`Olha esse: ${u} o que acha?`)).toEqual([
      { tipo: "texto", valor: "Olha esse: " },
      { tipo: "link", valor: u, href: u },
      { tipo: "texto", valor: " o que acha?" },
    ]);
  });
  it("www. vira https://", () => {
    expect(links("acesse www.srsdigitalpersonalizados.com agora")).toEqual(["https://www.srsdigitalpersonalizados.com"]);
  });
  it("ponto, vírgula e interrogação no fim ficam fora do link", () => {
    expect(links("veja https://x.com/a.")).toEqual(["https://x.com/a"]);
    expect(links("(https://x.com/a), ou https://y.com/b?")).toEqual(["https://x.com/a", "https://y.com/b"]);
  });
  it("parêntese que o link abriu continua nele", () => {
    expect(links("https://pt.wikipedia.org/wiki/Foo_(bar)")).toEqual(["https://pt.wikipedia.org/wiki/Foo_(bar)"]);
  });
  it("vários links na mesma mensagem, na ordem", () => {
    expect(links("a http://um.com e https://dois.com/x")).toEqual(["http://um.com", "https://dois.com/x"]);
  });
  it("esquemas perigosos e texto sem protocolo nunca viram link", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("data:text/html;base64,AAA")).toEqual([]);
    expect(links("mailto:a@b.com")).toEqual([]);
    expect(links("srsdigital.com sem protocolo")).toEqual([]);
    expect(links("https:// e www. sozinhos")).toEqual([]);
  });
  it("texto sem link volta inteiro; vazio volta vazio", () => {
    expect(separarLinks("Bom dia!\nTudo bem?")).toEqual([{ tipo: "texto", valor: "Bom dia!\nTudo bem?" }]);
    expect(separarLinks("")).toEqual([]);
  });
  it("preserva exatamente o texto ao redor (concatenar tudo reproduz a entrada, salvo o prefixo www)", () => {
    const t = "oi\nhttps://a.com/b?c=1,\nfim";
    expect(separarLinks(t).map((p) => p.valor).join("")).toBe(t);
  });
});
