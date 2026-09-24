-- 0401 — grupos do WhatsApp viram conversa no CRM (fork ricardoferrari01)
--
-- Habilita leitura E ENVIO em grupos, sem tratar como lead e sem a IA
-- responder — a doutrina de "sem deal infinito" (docs/prd/03-prd-whatsapp-waha.md
-- §7 W11) continua valendo; o que muda é que a mensagem passa a existir no CRM
-- em vez de ser descartada (ver lib/waha/ingest.ts e lib/waha/client.ts).
--
-- `conversations.is_group`/`group_chat_id` já existiam — schema pronto, nunca
-- ligado. Falta o mesmo par em `contacts`, porque toda conversa exige um
-- `contact_id` (FK NOT NULL, ON DELETE RESTRICT) e um grupo não é uma pessoa:
-- ele vira um contato PLACEHOLDER, sem telefone, com is_group=true.
--
-- Idempotente: add column if not exists + create index if not exists +
-- create or replace function. Conteúdo idêntico ao apêndice de mesmo nome em
-- supabase/baseline.sql — este arquivo existe para quem sincroniza via
-- `supabase db push` contra um projeto Supabase Cloud; a instalação
-- self-hosted (hostgator-setup-kit) aplica pelo baseline.sql.

alter table public.contacts
  add column if not exists is_group boolean not null default false,
  add column if not exists group_chat_id text;

create unique index if not exists uniq_contacts_org_group_chat_id
  on public.contacts (organization_id, group_chat_id)
  where group_chat_id is not null and is_merged_into is null;

-- upsert do contato-grupo: reencontra pelo group_chat_id (não por wa_identity,
-- que fica NULL para quem não tem telefone nem lid — sem risco de colidir com
-- pessoa). O nome é sempre atualizado quando um assunto novo chega (grupo pode
-- ser renomeado; ao contrário de pessoa, aqui vale o MAIS recente). Sem
-- assunto conhecido, cai num rótulo genérico com os últimos dígitos do id — o
-- atendente pode renomear como qualquer outro contato.
create or replace function public.fn_upsert_wa_group_contact(
  p_org uuid, p_group_chat_id text, p_subject text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_rotulo_generico text := 'Grupo ' || right(regexp_replace(p_group_chat_id, '@.*$', ''), 6);
begin
  insert into public.contacts (
    organization_id, is_group, group_chat_id, display_name,
    source, consent, tags, source_metadata
  )
  values (
    p_org, true, p_group_chat_id, coalesce(nullif(p_subject, ''), v_rotulo_generico),
    'whatsapp', '{}'::jsonb, '{}'::text[],
    jsonb_build_object('waha_chat_id', p_group_chat_id)
  )
  on conflict (organization_id, group_chat_id) where group_chat_id is not null and is_merged_into is null
  do update set
    display_name = coalesce(nullif(p_subject, ''), public.contacts.display_name),
    updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

-- upsert da conversa de grupo: mesma constraint que já existia
-- (conversations_unique_per_contact_session, (org, contact, session,
-- group_chat_id)) e nunca tinha upsert que a alcançasse —
-- fn_upsert_wa_conversation só sabe conflitar pela versão 1:1 (is_group=false).
create or replace function public.fn_upsert_wa_group_conversation(
  p_org uuid, p_contact uuid, p_session uuid, p_group_chat_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.conversations (
    organization_id, contact_id, channel_session_id, channel, status,
    is_group, group_chat_id, unread_count_for_assignee, metadata
  )
  values (p_org, p_contact, p_session, 'whatsapp', 'open', true, p_group_chat_id, 0, '{}'::jsonb)
  on conflict (organization_id, contact_id, channel_session_id, group_chat_id)
  do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.fn_upsert_wa_group_contact(uuid, text, text) from public;
revoke all on function public.fn_upsert_wa_group_conversation(uuid, uuid, uuid, text) from public;
grant execute on function public.fn_upsert_wa_group_contact(uuid, text, text) to service_role;
grant execute on function public.fn_upsert_wa_group_conversation(uuid, uuid, uuid, text) to service_role;
revoke execute on function public.fn_upsert_wa_group_contact(uuid, text, text) from anon, authenticated;
revoke execute on function public.fn_upsert_wa_group_conversation(uuid, uuid, uuid, text) from anon, authenticated;

notify pgrst, 'reload schema';
