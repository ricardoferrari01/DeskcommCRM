"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useForwardMessage } from "@/hooks/inbox/useForwardMessage";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { apiClient } from "@/lib/api/client";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { PISO_DA_BUSCA } from "@/lib/inbox/termo-de-busca";
import { MAX_DESTINOS } from "@/lib/messaging/encaminhar";
import { Check, MagnifyingGlass, UserCircle, UsersThree } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types/messaging";

interface Props {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROTULO_DO_TIPO: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
};

/** Escolher para quais conversas (contatos ou grupos) a mensagem vai — até 5, como no WhatsApp. */
export function ForwardMessageDialog({ message, open, onOpenChange }: Props) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [escolhidas, setEscolhidas] = useState<ConversationWithContact[]>([]);
  const encaminhar = useForwardMessage();

  // A bolha só monta este diálogo enquanto ele está aberto: fechar desmonta e
  // zera busca e escolhas, sem precisar limpar estado aqui.
  useEffect(() => {
    const timer = setTimeout(() => setTermo(busca.trim()), 250);
    return () => clearTimeout(timer);
  }, [busca]);

  const termoValido = termo.length >= PISO_DA_BUSCA ? termo : "";
  const lista = useQuery({
    queryKey: ["encaminhar-destinos", termoValido],
    enabled: open,
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "30" });
      if (termoValido) qs.set("search", termoValido);
      return apiClient.get<{ data: ConversationWithContact[] }>(`/api/v1/conversations?${qs.toString()}`);
    },
  });
  const conversas = lista.data?.data ?? [];
  const cheio = escolhidas.length >= MAX_DESTINOS;

  function alternar(c: ConversationWithContact) {
    setEscolhidas((atual) => {
      if (atual.some((x) => x.id === c.id)) return atual.filter((x) => x.id !== c.id);
      if (atual.length >= MAX_DESTINOS) return atual;
      return [...atual, c];
    });
  }

  function nome(c: ConversationWithContact): string {
    return rotuloDoContato(c.contacts ?? null, t);
  }

  async function enviar() {
    if (escolhidas.length === 0) return;
    const nomes = new Map(escolhidas.map((c) => [c.id, nome(c)]));
    try {
      const res = await encaminhar.mutateAsync({
        messageId: message.id,
        conversationIds: escolhidas.map((c) => c.id),
      });
      const resultados = res.data.resultados;
      const falhas = resultados.filter((r) => !r.ok);
      const enviados = resultados.length - falhas.length;
      if (falhas.length === 0) {
        toast.success(enviados === 1
          ? t("Mensagem encaminhada.")
          : t("Mensagem encaminhada para {n} conversas.").replace("{n}", String(enviados)));
        onOpenChange(false);
        return;
      }
      for (const f of falhas) {
        toast.error(`${nomes.get(f.conversation_id) ?? t("Conversa")}: ${f.erro ?? t("Não foi possível encaminhar.")}`);
      }
      if (enviados > 0) {
        toast.success(t("Encaminhada para {n} de {total} conversas.")
          .replace("{n}", String(enviados)).replace("{total}", String(resultados.length)));
        onOpenChange(false);
      }
    } catch {
      // O toast de erro já saiu no onError do hook; o diálogo fica aberto para tentar de novo.
    }
  }

  const previa = message.type === "text"
    ? (message.body ?? "")
    : `${t(ROTULO_DO_TIPO[message.type] ?? "Arquivo")}${message.body ? ` · ${message.body}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !encaminhar.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Encaminhar mensagem")}</DialogTitle>
          <DialogDescription>
            {t("Escolha até 5 contatos ou grupos. A mensagem sai do seu número, sem a etiqueta \"Encaminhada\".")}
          </DialogDescription>
        </DialogHeader>

        <p className="line-clamp-2 rounded-md border-l-2 border-primary bg-muted px-3 py-2 text-sm text-muted-foreground">
          {previa}
        </p>

        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar contato ou grupo…")}
            aria-label={t("Buscar contato ou grupo…")}
            className="pl-8"
            autoFocus
          />
        </div>

        {escolhidas.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-live="polite">
            {escolhidas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => alternar(c)}
                disabled={encaminhar.isPending}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                aria-label={`${t("Remover")} ${nome(c)}`}
              >
                {nome(c)} ×
              </button>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          {lista.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("Carregando…")}</p>
          ) : conversas.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("Nenhuma conversa encontrada.")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {conversas.map((c) => {
                const marcada = escolhidas.some((x) => x.id === c.id);
                const telefone = !c.is_group && c.contacts?.phone_number ? phoneForDisplay(c.contacts.phone_number) : null;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={marcada}
                      disabled={encaminhar.isPending || (!marcada && cheio)}
                      onClick={() => alternar(c)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm",
                        "hover:bg-muted disabled:opacity-50",
                        marcada && "bg-primary/5",
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        {c.is_group
                          ? <UsersThree size={20} weight="duotone" className="text-primary" aria-hidden />
                          : <UserCircle size={22} weight="duotone" className="text-primary" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{nome(c)}</span>
                          {c.is_group && (
                            <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                              {t("Grupo")}
                            </span>
                          )}
                        </span>
                        {telefone && <span className="block truncate text-xs text-muted-foreground">{telefone}</span>}
                      </span>
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                          marcada ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                        aria-hidden
                      >
                        {marcada && <Check size={12} weight="bold" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={encaminhar.isPending}>
            {t("Cancelar")}
          </Button>
          <Button type="button" onClick={enviar} disabled={escolhidas.length === 0 || encaminhar.isPending}>
            {encaminhar.isPending
              ? t("Encaminhando…")
              : escolhidas.length > 0
                ? `${t("Encaminhar")} (${escolhidas.length})`
                : t("Encaminhar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
