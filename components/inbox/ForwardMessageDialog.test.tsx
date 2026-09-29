import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Message } from "@/lib/types/messaging";

const post = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

const conversas = [
  { id: "c-maria", is_group: false, contacts: { name: "Maria", phone_number: "+5554999990001" } },
  { id: "c-grupo", is_group: true, contacts: { name: "Produção SRS", phone_number: null } },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `c-${i}`, is_group: false, contacts: { name: `Cliente ${i}`, phone_number: null } })),
];

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: () => Promise.resolve({ data: conversas }),
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ForwardMessageDialog } from "./ForwardMessageDialog";

const message = { id: "m-1", type: "text", body: "Arte aprovada" } as Message;

function renderizar(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ForwardMessageDialog message={message} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  post.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ForwardMessageDialog", () => {
  it("lista contatos e grupos e encaminha para os escolhidos", async () => {
    post.mockResolvedValue({ data: { resultados: [
      { conversation_id: "c-maria", ok: true, message_id: "x", erro: null },
      { conversation_id: "c-grupo", ok: true, message_id: "y", erro: null },
    ] } });
    const onOpenChange = renderizar();
    const user = userEvent.setup();
    expect(screen.getByText("Arte aprovada")).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: /Maria/ }));
    await user.click(screen.getByRole("checkbox", { name: /Produção SRS/ }));
    expect(screen.getByText("Grupo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Encaminhar (2)" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/messages/m-1/forward", { conversation_ids: ["c-maria", "c-grupo"] }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Mensagem encaminhada para 2 conversas."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("trava a escolha em 5 conversas", async () => {
    renderizar();
    const user = userEvent.setup();
    const itens = await screen.findAllByRole("checkbox");
    for (const item of itens.slice(0, 5)) await user.click(item);
    expect(itens[5]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Encaminhar (5)" })).toBeEnabled();
  });

  it("resultado parcial avisa qual destino falhou e diz quantos foram", async () => {
    post.mockResolvedValue({ data: { resultados: [
      { conversation_id: "c-maria", ok: false, message_id: null, erro: "Contato bloqueou o atendimento." },
      { conversation_id: "c-grupo", ok: true, message_id: "y", erro: null },
    ] } });
    renderizar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Maria/ }));
    await user.click(screen.getByRole("checkbox", { name: /Produção SRS/ }));
    await user.click(screen.getByRole("button", { name: "Encaminhar (2)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Maria: Contato bloqueou o atendimento."));
    expect(toastSuccess).toHaveBeenCalledWith("Encaminhada para 1 de 2 conversas.");
  });
});
