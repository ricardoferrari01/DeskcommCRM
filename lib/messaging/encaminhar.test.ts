import { describe, expect, it } from "vitest";

import { isMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";

import { caminhoDaCopia, encaminharSchema, MAX_DESTINOS, motivoParaNaoEncaminhar } from "./encaminhar";

const base = { type: "text", body: "oi", media_storage_path: null, revoked_at: null };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("motivoParaNaoEncaminhar", () => {
  it("texto com conteúdo pode", () => {
    expect(motivoParaNaoEncaminhar(base)).toBeNull();
  });
  it("mídia já guardada no bucket pode", () => {
    expect(motivoParaNaoEncaminhar({ ...base, type: "image", body: null, media_storage_path: "org/conv/x.jpg" })).toBeNull();
  });
  it("mídia ainda não baixada não pode", () => {
    expect(motivoParaNaoEncaminhar({ ...base, type: "document", body: null })).toBe("midia_pendente");
  });
  it("apagada não pode", () => {
    expect(motivoParaNaoEncaminhar({ ...base, revoked_at: "2026-09-29T00:00:00Z" })).toBe("apagada");
  });
  it("figurinha, cartão, local e modelo não podem", () => {
    for (const type of ["sticker", "contact", "location", "template"]) {
      expect(motivoParaNaoEncaminhar({ ...base, type, media_storage_path: "org/conv/x" })).toBe("tipo");
    }
  });
  it("texto vazio não pode", () => {
    expect(motivoParaNaoEncaminhar({ ...base, body: "   " })).toBe("vazia");
  });
});

describe("caminhoDaCopia", () => {
  it("fica dentro da pasta da conversa de destino (a regra que o envio confere)", () => {
    const p = caminhoDaCopia("org-1", "conv-2", "document", "org-1/conv-1/abc.pdf", "u1", "application/pdf");
    expect(p).toBe("org-1/conv-2/fwd-u1/documento.pdf");
    expect(isMediaPathOwnedBy(p, "org-1", "conv-2")).toBe(true);
    expect(isMediaPathOwnedBy(p, "org-1", "conv-1")).toBe(false);
  });
  it("sem extensão na origem, usa a do mime", () => {
    expect(caminhoDaCopia("o", "c", "image", "o/c/semext", "u", "image/jpeg")).toMatch(/\/imagem\.jpg$/);
  });
});

describe("encaminharSchema", () => {
  it(`aceita de 1 a ${MAX_DESTINOS} conversas`, () => {
    expect(encaminharSchema.safeParse({ conversation_ids: [uuid(1)] }).success).toBe(true);
    const cinco = Array.from({ length: MAX_DESTINOS }, (_, i) => uuid(i + 1));
    expect(encaminharSchema.safeParse({ conversation_ids: cinco }).success).toBe(true);
  });
  it("recusa lista vazia, acima do limite e repetida", () => {
    expect(encaminharSchema.safeParse({ conversation_ids: [] }).success).toBe(false);
    const seis = Array.from({ length: MAX_DESTINOS + 1 }, (_, i) => uuid(i + 1));
    expect(encaminharSchema.safeParse({ conversation_ids: seis }).success).toBe(false);
    expect(encaminharSchema.safeParse({ conversation_ids: [uuid(1), uuid(1)] }).success).toBe(false);
  });
});
