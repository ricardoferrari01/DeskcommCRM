import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent, parseChatId, type WahaEnvelope, type WahaPayload } from "@/lib/waha/ingest";

/**
 * UM CHAT QUE NÃO SABEMOS LER TEM QUE APARECER EM ALGUM LUGAR.
 *
 * `parseChatId` jogava QUALQUER sufixo desconhecido no balde `group`, e o
 * ingest descartava grupo inteiro — então "não sei ler isto" virava "descarta
 * calado", a mesma família do defeito do PR #108 (a mensagem do celular sumia
 * sem erro, webhook devolvendo 200). O WhatsApp já tem `@newsletter` e
 * `@broadcast` em produção; o próximo formato reproduz o sintoma inteiro.
 *
 * A separação continua valendo: desconhecido é descarte que precisa deixar
 * rastro (`whatsapp.chat_id_not_recognized`). Grupo MUDOU de lado (fork
 * ricardoferrari01, ver lib/waha/ingest.ts): deixou de ser descarte — agora
 * vira contato-placeholder, conversa e mensagem própria, por um caminho
 * SEPARADO (`fn_upsert_wa_group_contact`/`fn_upsert_wa_group_conversation`),
 * nunca pelo `fn_upsert_wa_contact` de pessoa.
 *
 * ⚠️ O RISCO DE INTRODUZIR ALGO PIOR mora no upsert de contato, e é por isso que
 * o caso de vazamento existe aqui. `fn_upsert_wa_contact` NÃO valida `p_kind`, e
 * `contacts.wa_identity` é coluna GERADA que só vira `phone:`/`lid:` — qualquer
 * outro kind produz `wa_identity` NULL. Como o `on conflict` da RPC é
 * `(organization_id, wa_identity) WHERE wa_identity is not null`, uma linha NULL
 * nunca conflita: cada webhook criaria um CONTATO ÓRFÃO NOVO. É exatamente o
 * anti-pattern que a migration 0027 veio matar — e é exatamente por isso que
 * grupo tem RPC própria em vez de reusar esta.
 */

interface Duplo {
  admin: unknown;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  messages: Array<Record<string, unknown>>;
}

function bancoDeMentira(): Duplo {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const messages: Array<Record<string, unknown>> = [];
  const consulta = () => {
    const q = {
      eq: () => q,
      in: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return q;
  };
  const admin = {
    from: () => ({
      select: () => consulta(),
      insert: (linha: Record<string, unknown>) => ({
        select: () => ({
          maybeSingle: async () => {
            messages.push(linha);
            return { data: { id: `msg-${messages.length}` }, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      if (fn === "fn_upsert_wa_group_contact") return { data: "contato-grupo-1", error: null };
      if (fn === "fn_upsert_wa_group_conversation") return { data: "conversa-grupo-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, rpcs, messages };
}

const SESSION = { id: "sessao-1", organization_id: "org-1" };

function inbound(from: string): WahaEnvelope {
  const payload: WahaPayload = { id: `false_${from}_3EB0ABC`, from, fromMe: false, body: "oi" };
  return { event: "message.any", session: "default", payload };
}

describe("parseChatId separa desconhecido de grupo", () => {
  it("os formatos que sabemos ler continuam iguais", async () => {
    // Guarda de vacuidade: sem isto, um parseChatId que devolvesse "unknown"
    // para tudo passaria nos casos abaixo.
    expect(parseChatId("5511999999999@c.us")).toEqual({ kind: "phone", phone: "+5511999999999", lid: null });
    expect(parseChatId("250302204792918@lid")).toEqual({ kind: "lid", phone: null, lid: "250302204792918" });
    expect(parseChatId("120363000000000000@g.us")).toEqual({ kind: "group", phone: null, lid: null });
    expect(parseChatId("5511999999999@s.whatsapp.net")).toEqual({
      kind: "phone",
      phone: "+5511999999999",
      lid: null,
    });
  });

  it("sufixo que não conhecemos NÃO é grupo", async () => {
    // O WhatsApp já usa os dois em produção; nenhum é grupo.
    expect(parseChatId("11111111111@newsletter").kind).toBe("unknown");
    expect(parseChatId("status@broadcast").kind).toBe("unknown");
    // E o caso que originou o #108: string vazia não é grupo, é ausência de dado.
    expect(parseChatId("").kind).toBe("unknown");
  });
});

describe("o chat não reconhecido deixa rastro", () => {
  it("emite whatsapp.chat_id_not_recognized em vez de sumir calado", async () => {
    const { admin, rpcs } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("11111111111@newsletter"), "req-1");

    const aviso = rpcs.find(
      (c) => c.fn === "emit_event" && c.args.p_event_type === "whatsapp.chat_id_not_recognized",
    );
    expect(aviso, "o chat desconhecido foi descartado sem deixar rastro nenhum").toBeDefined();
    expect(aviso!.args.p_organization_id).toBe("org-1");
  });

  it("registra o SUFIXO, não o identificador do contato", async () => {
    // O que responde "que formato novo é este?" é o sufixo. O identificador
    // inteiro é dado de uma pessoa e não tem propósito no log operacional —
    // mesma doutrina de whatsapp.conversation_mark_failed, que não copia o texto.
    const { admin, rpcs } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("11111111111@newsletter"), "req-1");

    const aviso = rpcs.find(
      (c) => c.fn === "emit_event" && c.args.p_event_type === "whatsapp.chat_id_not_recognized",
    )!;
    expect(JSON.stringify(aviso.args)).toContain("@newsletter");
    expect(JSON.stringify(aviso.args), "vazou o identificador do contato para o log").not.toContain(
      "11111111111",
    );
  });

  it("grupo NÃO emite aviso de chat não reconhecido — grupo é caminho próprio, não anomalia", async () => {
    // O controle que impede o teste de passar por acidente: se o aviso saísse em
    // todo caso, as asserções acima passariam sem provar nada sobre o
    // desconhecido. Grupo tem caminho DEDICADO (ver describe abaixo) — não é
    // nem "descarta calado" (doutrina antiga) nem "anomalia" (o caso do
    // desconhecido).
    const { admin, rpcs } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("120363000000000000@g.us"), "req-1");

    const avisos = rpcs.filter(
      (c) => c.fn === "emit_event" && c.args.p_event_type === "whatsapp.chat_id_not_recognized",
    );
    expect(avisos).toHaveLength(0);
  });
});

describe("o chat não reconhecido NÃO vira contato", () => {
  it("nunca chama fn_upsert_wa_contact com kind fora de phone|lid", async () => {
    // Esta é a asserção que impede a correção de introduzir algo pior que o
    // defeito. `wa_identity` é gerada e fica NULL para qualquer outro kind; como
    // o `on conflict` da RPC exige `wa_identity is not null`, a linha nunca
    // conflita e NASCE UM CONTATO NOVO A CADA WEBHOOK.
    //
    // Grupo SAIU deste teste (fork ricardoferrari01): ele passou a virar
    // mensagem de verdade, só que por uma RPC dedicada
    // (`fn_upsert_wa_group_contact`) — ver o describe "mensagem de grupo" logo
    // abaixo para essa asserção. Continuam aqui só os formatos que de fato
    // permanecem "não endereçável" (`@newsletter`, `@broadcast`).
    const { admin, rpcs, messages } = bancoDeMentira();

    for (const chat of ["11111111111@newsletter", "status@broadcast"]) {
      await dispatchWahaEvent(admin as never, SESSION as never, inbound(chat), "req-1");
    }

    const kinds = rpcs.filter((c) => c.fn === "fn_upsert_wa_contact").map((c) => c.args.p_kind);
    expect(kinds, "vazou um kind não-endereçável para o upsert de contato").toEqual([]);
    expect(messages, "chat não endereçável não vira mensagem").toHaveLength(0);
  });

  it("controle: chat endereçável continua virando contato", async () => {
    const { admin, rpcs, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("5511999999999@c.us"), "req-1");

    const kinds = rpcs.filter((c) => c.fn === "fn_upsert_wa_contact").map((c) => c.args.p_kind);
    expect(kinds).toEqual(["phone"]);
    expect(messages).toHaveLength(1);
  });
});

describe("mensagem de grupo vira conversa própria, nunca lead (fork ricardoferrari01)", () => {
  it("grupo chama a RPC de grupo, nunca fn_upsert_wa_contact de pessoa", async () => {
    const { admin, rpcs, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("120363000000000000@g.us"), "req-1");

    const kindsDePessoa = rpcs.filter((c) => c.fn === "fn_upsert_wa_contact");
    expect(kindsDePessoa, "grupo vazou para o upsert de PESSOA").toEqual([]);

    const grupoContato = rpcs.filter((c) => c.fn === "fn_upsert_wa_group_contact");
    const grupoConversa = rpcs.filter((c) => c.fn === "fn_upsert_wa_group_conversation");
    expect(grupoContato).toHaveLength(1);
    expect(grupoConversa).toHaveLength(1);
    expect(grupoContato[0]?.args.p_group_chat_id).toBe("120363000000000000@g.us");
    expect(messages, "mensagem de grupo passou a ser gravada").toHaveLength(1);
  });

  it("nunca chama os efeitos de lead/IA (aplicarEfeitosPosEntrada não roda para grupo)", async () => {
    // Doutrina do PRD (§7 W11): grupo não pode virar "deal infinito". A prova
    // aqui é por AUSÊNCIA — nenhuma chamada de RPC deste dispatch tem nome que
    // sugira lead/pipeline/agente, e a única mensagem inserida não passa por
    // nenhum caminho que crie lead nesta suíte (ver o mock: `rpc()` cobre só o
    // que os dois upserts de grupo e `markConversation`/`emit_event` chamam).
    const { admin, rpcs } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, inbound("120363000000000000@g.us"), "req-1");

    const nomesSuspeitos = rpcs
      .map((c) => c.fn)
      .filter((fn) => /lead|pipeline|agent|deal/i.test(fn));
    expect(nomesSuspeitos, "grupo acionou algo de lead/pipeline/agente").toEqual([]);
  });
});
