"use client";

import { separarLinks } from "@/lib/messaging/separar-links";

/**
 * Texto de mensagem com os endereços web clicáveis. O conteúdo vira nós do React
 * (nunca HTML), então uma mensagem de cliente não consegue injetar marcação.
 * Abre em nova aba, sem `opener` e sem repassar referrer.
 */
export function TextoComLinks({ texto }: { texto: string }) {
  return (
    <>
      {separarLinks(texto).map((p, i) =>
        p.tipo === "texto" ? (
          p.valor
        ) : (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2 break-all hover:opacity-80"
          >
            {p.valor}
          </a>
        ),
      )}
    </>
  );
}
