import { describe, expect, it } from "vitest";

import type { WahaPayload } from "./envelope";
import { metadadosDeArquivo } from "./arquivo";

describe("metadadosDeArquivo", () => {
  it("lê media.filename (formato real do WAHA 2026.7)", () => {
    const p = { media: { url: "x", mimetype: "application/pdf", filename: "Guia_DTF_Textil_SRS_Digital_v3.pdf" } } as WahaPayload;
    expect(metadadosDeArquivo(p)).toEqual({ filename: "Guia_DTF_Textil_SRS_Digital_v3.pdf" });
  });
  it("cai para documentMessage.fileName e depois title", () => {
    const a = { media: { filename: null }, _data: { message: { documentMessage: { fileName: "a.pdf", title: "t.pdf" } } } } as unknown as WahaPayload;
    expect(metadadosDeArquivo(a)).toEqual({ filename: "a.pdf" });
    const b = { _data: { message: { documentMessage: { title: "t.pdf" } } } } as unknown as WahaPayload;
    expect(metadadosDeArquivo(b)).toEqual({ filename: "t.pdf" });
  });
  it("sem nome (imagem, vídeo, texto) devolve objeto vazio", () => {
    expect(metadadosDeArquivo({ media: { filename: null } } as unknown as WahaPayload)).toEqual({});
    expect(metadadosDeArquivo({ body: "oi" } as WahaPayload)).toEqual({});
    expect(metadadosDeArquivo({ media: "x" } as unknown as WahaPayload)).toEqual({});
  });
});
