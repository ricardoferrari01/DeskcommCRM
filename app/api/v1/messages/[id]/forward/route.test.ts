import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  role: "agent",
  message: null as Record<string, unknown> | null,
  conversas: new Set<string>(),
  copias: [] as Array<{ de: string; para: string }>,
  copiaFalha: false,
  envios: [] as Array<Record<string, unknown>>,
  envio: vi.fn(),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ["agent", "manager", "admin"].includes(state.role)
    ? { ok: true, user: { id: "usuario-1", idioma: "pt-BR" }, org: { orgId: "org-1" } }
    : { ok: false, response: new Response(null, { status: 403 }) },
}));
vi.mock("@/lib/audit", () => ({ audit: state.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let id: unknown;
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { if (col === "id") id = v; return q; },
        maybeSingle: async () => ({
          data: table === "messages"
            ? state.message
            : state.conversas.has(String(id)) ? { id } : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        copy: async (de: string, para: string) => {
          state.copias.push({ de, para });
          return { error: state.copiaFalha ? { message: "boom" } : null };
        },
      }),
    },
  }),
}));
vi.mock("../../_handler", () => ({ sendMessageHandler: state.envio }));

import { ApiError } from "@/lib/api/types";

import { POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const destinoA = "22222222-2222-4222-8222-222222222222";
const destinoB = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id }) };
const req = (body: unknown) =>
  new NextRequest(`http://localhost/api/v1/messages/${id}/forward`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.role = "agent";
  state.copias.length = 0;
  state.copiaFalha = false;
  state.envios.length = 0;
  state.conversas = new Set([destinoA, destinoB]);
  state.audit.mockClear();
  state.envio.mockReset();
  state.envio.mockImplementation(async (_sb: unknown, _ctx: unknown, input: Record<string, unknown>) => {
    state.envios.push(input);
    return { id: `msg-${state.envios.length}`, status: "sent", error_message: null };
  });
  state.message = {
    id, conversation_id: "conversa-origem", type: "text", body: "Orçamento aprovado",
    media_storage_path: null, media_mime: null, media_size_bytes: null, revoked_at: null,
  };
});

describe("encaminhar mensagem", () => {
  it("reenvia o texto para cada destino pela porta comum de envio", async () => {
    const res = await POST(req({ conversation_ids: [destinoA, destinoB] }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.resultados).toEqual([
      { conversation_id: destinoA, ok: true, message_id: "msg-1", erro: null },
      { conversation_id: destinoB, ok: true, message_id: "msg-2", erro: null },
    ]);
    expect(state.envios[0]).toMatchObject({
      conversation_id: destinoA, type: "text", body: "Orçamento aprovado",
      metadata: { forwarded_from_message_id: id },
    });
    expect(state.envios[0]!.media_storage_path).toBeUndefined();
    expect(state.copias).toEqual([]);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "message.forwarded", resourceId: id,
      metadata: expect.objectContaining({ destinos: 2, enviados: 2 }),
    }));
  });

  it("copia a mídia para a pasta de cada destino antes de enviar", async () => {
    state.message = {
      ...state.message, type: "document", body: null,
      media_storage_path: "org-1/conversa-origem/abc.pdf", media_mime: "application/pdf", media_size_bytes: 1234,
    };
    const res = await POST(req({ conversation_ids: [destinoA] }), ctx);
    expect(res.status).toBe(200);
    expect(state.copias).toHaveLength(1);
    expect(state.copias[0]!.de).toBe("org-1/conversa-origem/abc.pdf");
    expect(state.copias[0]!.para).toMatch(new RegExp(`^org-1/${destinoA}/fwd-[^/]+/documento\\.pdf$`));
    expect(state.envios[0]).toMatchObject({
      type: "document", media_storage_path: state.copias[0]!.para, media_mime: "application/pdf", media_size_bytes: 1234,
    });
  });

  it("não escreve no bucket de conversa que não é da org / não é visível", async () => {
    state.message = { ...state.message, type: "image", body: null, media_storage_path: "org-1/conversa-origem/a.jpg" };
    state.conversas = new Set([destinoA]);
    const res = await POST(req({ conversation_ids: [destinoA, destinoB] }), ctx);
    const json = await res.json();
    expect(state.copias).toHaveLength(1);
    expect(json.data.resultados[1]).toMatchObject({ conversation_id: destinoB, ok: false });
    expect(state.envios).toHaveLength(1);
  });

  it("resultado parcial: um destino recusado não derruba os outros", async () => {
    state.envio.mockImplementation(async (_sb: unknown, _ctx: unknown, input: Record<string, unknown>) => {
      if (input.conversation_id === destinoA) {
        throw new ApiError(403, "forbidden", undefined, "r", "Contato bloqueou o atendimento.");
      }
      return { id: "msg-b", status: "sent", error_message: null };
    });
    const res = await POST(req({ conversation_ids: [destinoA, destinoB] }), ctx);
    const json = await res.json();
    expect(json.data.resultados).toEqual([
      { conversation_id: destinoA, ok: false, message_id: null, erro: "Contato bloqueou o atendimento." },
      { conversation_id: destinoB, ok: true, message_id: "msg-b", erro: null },
    ]);
  });

  it("envio que o canal recusou volta como falha daquele destino", async () => {
    state.envio.mockResolvedValue({ id: "msg-x", status: "failed", error_message: "Número inválido" });
    const json = await (await POST(req({ conversation_ids: [destinoA] }), ctx)).json();
    expect(json.data.resultados[0]).toEqual({ conversation_id: destinoA, ok: false, message_id: "msg-x", erro: "Número inválido" });
  });

  it("recusa mensagem apagada, tipo não suportado e mídia ainda não baixada", async () => {
    state.message = { ...state.message, revoked_at: "2026-09-29T00:00:00Z" };
    expect((await POST(req({ conversation_ids: [destinoA] }), ctx)).status).toBe(422);
    state.message = { ...state.message, revoked_at: null, type: "sticker", media_storage_path: "x" };
    expect((await POST(req({ conversation_ids: [destinoA] }), ctx)).status).toBe(422);
    state.message = { ...state.message, type: "video", media_storage_path: null };
    expect((await POST(req({ conversation_ids: [destinoA] }), ctx)).status).toBe(422);
    expect(state.envios).toEqual([]);
  });

  it("recusa mais de 5 destinos e lista repetida", async () => {
    const seis = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await POST(req({ conversation_ids: seis }), ctx)).status).toBe(422);
    expect((await POST(req({ conversation_ids: [destinoA, destinoA] }), ctx)).status).toBe(422);
  });

  it("viewer não encaminha", async () => {
    state.role = "viewer";
    expect((await POST(req({ conversation_ids: [destinoA] }), ctx)).status).toBe(403);
    expect(state.envios).toEqual([]);
  });

  it("mensagem de outra org / invisível é 404", async () => {
    state.message = null;
    expect((await POST(req({ conversation_ids: [destinoA] }), ctx)).status).toBe(404);
  });
});
