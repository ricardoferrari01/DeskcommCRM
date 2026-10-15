/**
 * Reconhece endereços web dentro de um texto de mensagem, para a bolha do Inbox
 * poder mostrá-los como links clicáveis.
 *
 * Só `http://`, `https://` e `www.` viram link. `javascript:`, `data:`, `mailto:` e
 * afins nunca casam — o padrão exige o prefixo, não o exclui. O resultado é uma
 * lista de pedaços (texto | link) que o componente desenha com nós do React, nunca
 * como HTML: o texto de um cliente jamais é interpretado como marcação.
 */
export type PedacoDeTexto =
  | { tipo: "texto"; valor: string }
  | { tipo: "link"; valor: string; href: string };

const PADRAO = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Pontuação colada no fim do endereço ("veja https://x.com/a.") não pertence a ele. */
function aparar(url: string): { link: string; sobra: string } {
  let link = url;
  for (;;) {
    const ultimo = link.slice(-1);
    if (/[.,;:!?'"»…]/.test(ultimo)) {
      link = link.slice(0, -1);
      continue;
    }
    // Parêntese/colchete/chave de fechamento só é do link se ele abriu um antes.
    const par: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const abre = par[ultimo];
    if (abre !== undefined) {
      const abertos = link.split(abre).length - 1;
      const fechados = link.split(ultimo).length - 1;
      if (fechados > abertos) {
        link = link.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return { link, sobra: url.slice(link.length) };
}

export function separarLinks(texto: string): PedacoDeTexto[] {
  const saida: PedacoDeTexto[] = [];
  let cursor = 0;
  const empurrarTexto = (valor: string) => {
    if (valor === "") return;
    const ultimo = saida[saida.length - 1];
    if (ultimo?.tipo === "texto") ultimo.valor += valor;
    else saida.push({ tipo: "texto", valor });
  };
  for (const m of texto.matchAll(PADRAO)) {
    const inicio = m.index ?? 0;
    const { link, sobra } = aparar(m[0]);
    // "www." sozinho, ou "https://" sem nada depois, não é endereço.
    if (!/^(?:https?:\/\/|www\.)[^\s.\/]/i.test(link)) continue;
    empurrarTexto(texto.slice(cursor, inicio));
    saida.push({ tipo: "link", valor: link, href: /^www\./i.test(link) ? `https://${link}` : link });
    empurrarTexto(sobra);
    cursor = inicio + m[0].length;
  }
  empurrarTexto(texto.slice(cursor));
  return saida;
}
