import { describe, expect, it } from "vitest";

import type { WahaPayload } from "./envelope";
import { lerCitacaoWaha, resolverCitacao } from "./citacao";

const base = { id: "true_4071662587929@lid_2AC7", from: "4071662587929@lid", fromMe: true, body: "oi" };

describe("lerCitacaoWaha", () => {
  it("lê payload.replyTo com id curto (formato real do WAHA 2026.7)", () => {
    const p = { ...base, replyTo: { id: "2A75F68C440EBBB8254A", participant: "x@lid", hasMedia: false } } as WahaPayload;
    expect(lerCitacaoWaha(p)).toEqual({ idCitado: "2A75F68C440EBBB8254A", temMidia: false, album: null, origem: "replyTo" });
  });
  it("reconhece álbum", () => {
    const p = { ...base, replyTo: { id: "AB12CD34EF", _data: { albumMessage: { expectedImageCount: 3 } } } } as WahaPayload;
    expect(lerCitacaoWaha(p)?.album).toEqual({ imagens: 3 });
  });
  it("cai para contextInfo.stanzaId do NOWEB", () => {
    const p = { ...base, _data: { message: { imageMessage: { contextInfo: { stanzaId: "3EB0AAAA1111" } } } } } as WahaPayload;
    expect(lerCitacaoWaha(p)).toMatchObject({ idCitado: "3EB0AAAA1111", origem: "contextInfo" });
  });
  it("aceita id no formato WEBJS (_serialized)", () => {
    const p = { ...base, replyTo: { id: { _serialized: "false_1@c.us_3EB0FFFF" } } } as unknown as WahaPayload;
    expect(lerCitacaoWaha(p)?.idCitado).toBe("false_1@c.us_3EB0FFFF");
  });
  it("sem citação devolve null, inclusive com replyTo nulo ou lixo", () => {
    expect(lerCitacaoWaha(base as WahaPayload)).toBeNull();
    expect(lerCitacaoWaha({ ...base, replyTo: null } as unknown as WahaPayload)).toBeNull();
    expect(lerCitacaoWaha({ ...base, replyTo: "x" } as unknown as WahaPayload)).toBeNull();
    expect(lerCitacaoWaha({ ...base, _data: { message: "texto" } } as unknown as WahaPayload)).toBeNull();
  });
});

/** Banco falso: cada `maybeSingle()` consome a próxima resposta e registra os filtros. */
function bancoFalso(respostas: Array<{ id: string } | null>) {
  const chamadas: string[] = [];
  const fila = [...respostas];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "like", "lte", "order", "limit"]) {
    q[m] = (...a: unknown[]) => { chamadas.push(`${m}:${JSON.stringify(a)}`); return q; };
  }
  q["maybeSingle"] = async () => ({ data: fila.shift() ?? null, error: null });
  return { admin: { from: () => q } as never, chamadas };
}

describe("resolverCitacao", () => {
  const p = { ...base, replyTo: { id: "2A75F68C440EBBB8254A", hasMedia: true } } as WahaPayload;

  it("sem citação não consulta nada e não suja o metadata", async () => {
    const { admin, chamadas } = bancoFalso([]);
    expect(await resolverCitacao(admin, "org", "conv", base as WahaPayload, "2026-10-15T10:00:00Z")).toEqual({ replyToMessageId: null, metadata: {} });
    expect(chamadas).toHaveLength(0);
  });
  it("acha pela forma composta/curta e devolve o uuid", async () => {
    const { admin, chamadas } = bancoFalso([{ id: "uuid-foto" }]);
    const r = await resolverCitacao(admin, "org", "conv", p, "2026-10-15T10:00:00Z");
    expect(r.replyToMessageId).toBe("uuid-foto");
    expect(r.metadata).toMatchObject({ reply_context: { resolved: true, quoted_external_id: "2A75F68C440EBBB8254A" } });
    expect(chamadas.join(" ")).toContain("true_4071662587929@lid_2A75F68C440EBBB8254A");
  });
  it("cai para a cauda do id dentro da conversa", async () => {
    const { admin } = bancoFalso([null, { id: "uuid-2" }]);
    expect((await resolverCitacao(admin, "org", "conv", p, "t")).replyToMessageId).toBe("uuid-2");
  });
  it("citada que não está no banco vira só metadata", async () => {
    const { admin } = bancoFalso([null, null]);
    const r = await resolverCitacao(admin, "org", "conv", p, "t");
    expect(r.replyToMessageId).toBeNull();
    expect(r.metadata).toMatchObject({ reply_context: { resolved: false } });
  });
  it("álbum: liga à imagem mais recente e marca como aproximado", async () => {
    const alb = { ...base, replyTo: { id: "AB12CD34EF56", _data: { albumMessage: { expectedImageCount: 3 } } } } as WahaPayload;
    const { admin } = bancoFalso([null, null, { id: "uuid-img" }]);
    const r = await resolverCitacao(admin, "org", "conv", alb, "2026-10-15T10:00:00Z");
    expect(r.replyToMessageId).toBe("uuid-img");
    expect(r.metadata).toMatchObject({ reply_context: { resolved: true, approximate: true, album_images: 3 } });
  });
  it("id fora do padrão alfanumérico nunca vai para a consulta", async () => {
    const evil = { ...base, replyTo: { id: "x,y)or(1" } } as WahaPayload;
    const { admin, chamadas } = bancoFalso([]);
    const r = await resolverCitacao(admin, "org", "conv", evil, "t");
    expect(r.replyToMessageId).toBeNull();
    expect(chamadas).toHaveLength(0);
  });
  it("erro do banco não derruba a ingestão", async () => {
    const admin = { from: () => { throw new Error("db fora"); } } as never;
    const avisos: string[] = [];
    const r = await resolverCitacao(admin, "org", "conv", p, "t", (m) => avisos.push(m));
    expect(r).toEqual({ replyToMessageId: null, metadata: {} });
    expect(avisos).toHaveLength(1);
  });
});
