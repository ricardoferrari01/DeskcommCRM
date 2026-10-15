import { describe, expect, it } from "vitest";

import { limparNomeDeArquivo, nomeExibido, nomeParaEnvio } from "./nome-do-arquivo";

describe("limparNomeDeArquivo", () => {
  it("mantém um nome normal, com acento e espaço", () => {
    expect(limparNomeDeArquivo("Orçamento Ricardo v2.pdf")).toBe("Orçamento Ricardo v2.pdf");
  });
  it("remove caminho (Windows e Unix) e pontos iniciais", () => {
    expect(limparNomeDeArquivo("C:\\Users\\x\\Docs\\a.pdf")).toBe("a.pdf");
    expect(limparNomeDeArquivo("../../etc/passwd")).toBe("passwd");
    expect(limparNomeDeArquivo(".oculto.txt")).toBe("oculto.txt");
  });
  it("remove controle e inversores de texto (disfarce de extensão)", () => {
    expect(limparNomeDeArquivo("fatura\u202Efdp.exe")).toBe("faturafdp.exe");
    expect(limparNomeDeArquivo("a\u0000b\nc.pdf")).toBe("abc.pdf");
  });
  it("limita o tamanho preservando a extensão", () => {
    const r = limparNomeDeArquivo("x".repeat(300) + ".pdf")!;
    expect(r.length).toBe(120);
    expect(r.endsWith(".pdf")).toBe(true);
  });
  it("vazio, só espaços ou não-string viram null", () => {
    expect(limparNomeDeArquivo("")).toBeNull();
    expect(limparNomeDeArquivo("   ")).toBeNull();
    expect(limparNomeDeArquivo("///")).toBeNull();
    expect(limparNomeDeArquivo(42)).toBeNull();
    expect(limparNomeDeArquivo(undefined)).toBeNull();
  });
});

describe("nomeParaEnvio", () => {
  it("usa o nome original", () => {
    expect(nomeParaEnvio("Orcamento_Teste.pdf", "org/conv/out-abc.pdf", "application/pdf")).toBe("Orcamento_Teste.pdf");
  });
  it("completa a extensão pelo tipo quando o nome não a tem", () => {
    expect(nomeParaEnvio("Orcamento 1.2", "org/c/out-abc.pdf", "application/pdf")).toBe("Orcamento 1.2.pdf");
    expect(nomeParaEnvio("Orcamento", null, "application/pdf")).toBe("Orcamento.pdf");
  });
  it("sem nome, usa 'documento' com a extensão do armazenamento ou do tipo", () => {
    expect(nomeParaEnvio(undefined, "org/c/out-9f.pdf", "application/pdf")).toBe("documento.pdf");
    expect(nomeParaEnvio(undefined, "org/c/uuid.bin", "image/vnd.dxf")).toBe("documento.dxf");
    expect(nomeParaEnvio(undefined, "org/c/uuid.bin", "application/octet-stream")).toBe("documento");
  });
  it("nunca devolve o nome aleatório do armazenamento", () => {
    expect(nomeParaEnvio(undefined, "org/c/out-f30c0e25-a9ab.pdf", "application/pdf")).not.toContain("f30c0e25");
  });
});

describe("nomeExibido", () => {
  it("lê metadata.filename higienizado", () => {
    expect(nomeExibido({ filename: "Guia_DTF.pdf", fromMe: true })).toBe("Guia_DTF.pdf");
    expect(nomeExibido({ filename: "a/b.pdf" })).toBe("b.pdf");
  });
  it("sem nome ou metadata inválido devolve null", () => {
    expect(nomeExibido({})).toBeNull();
    expect(nomeExibido(null)).toBeNull();
    expect(nomeExibido("x")).toBeNull();
    expect(nomeExibido({ filename: 5 })).toBeNull();
  });
});
