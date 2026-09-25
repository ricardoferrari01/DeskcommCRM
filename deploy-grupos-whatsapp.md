# Grupos do WhatsApp no CRM — como aplicar

Isto habilita ler e responder grupos do WhatsApp pelo CRM, sem transformar
grupo em lead e sem a IA responder dentro dele (exatamente como você pediu).

## O que muda

- **`lib/waha/client.ts`** — o WAHA passa a ENTREGAR eventos de grupo (antes
  ele nem processava: `config.ignore.groups` estava `true`).
- **`lib/waha/ingest.ts`** — mensagem de grupo passa a virar contato-placeholder
  (o grupo em si, sem telefone) + conversa + mensagem, só que por um caminho
  separado do de pessoa. Continua **sem lead e sem IA** — a mesma regra de
  antes, só que decidida aqui em vez de descartar a mensagem inteira. Quem
  escreveu dentro do grupo fica registrado em cada mensagem.
- **`supabase/baseline.sql` + `supabase/migrations/0409_...`** — duas colunas
  novas em `contacts` (`is_group`, `group_chat_id`) e duas funções novas no
  banco. Testei à mão contra um Postgres 16 limpo: upsert idempotente, nome do
  grupo atualiza quando descoberto, dois grupos não colidem entre si, e o
  fluxo de conversa 1:1 de pessoa continua exatamente igual.
- **Tela** — um selo "Grupo" na lista de conversas e no cabeçalho, e o nome de
  quem falou aparece em cima de cada mensagem recebida dentro do grupo.
- **Envio pelo composer** já funcionava — o código que manda mensagem já sabia
  resolver `is_group`/`group_chat_id`, só nunca tinha conversa de grupo para
  usar. Não precisei mexer ali.

## Passo a passo na VPS

Tudo em `~/DeskcommCRM-novo`.

### 1. Aplicar o patch

Baixe o arquivo `0001-grupos-whatsapp-no-crm.patch` e mande para a VPS (`scp`
ou cole o conteúdo com um editor). Depois:

```bash
cd ~/DeskcommCRM-novo
git am 0001-grupos-whatsapp-no-crm.patch
```

Isso já cria o commit com a mensagem explicando a mudança. Se quiser conferir
antes: `git am --show-current-patch` ou simplesmente abra o `.patch` num
editor — é diff comum.

### 2. Aplicar a migration no banco AGORA

A rotina semanal/mensal do runbook (rebuild + `docker compose up -d`) **não**
reaplica schema — só troca a imagem do app. Esta mudança tem uma migration
nova, então roda ela uma vez, direto — o patch já traz um script que fala com
o banco do mesmo jeito que `backup.sh`/`restore.sh` já falam (por
`url_do_schema`, nunca por porta pública):

```bash
cd ~/DeskcommCRM-novo
bash hostgator-setup-kit/aplicar-migration-grupos.sh
```

É seguro rodar mais de uma vez — a migration é idempotente (`if not exists` /
`create or replace` em tudo).

### 3. Rebuild e redeploy (rotina de sempre)

```bash
cd ~/DeskcommCRM-novo
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build
docker compose -f docker-compose.prod.yml -f docker-compose.single-server.yml -f docker-compose.build.yml up -d
bash hostgator-setup-kit/healthcheck.sh
```

### 4. Fazer o WAHA parar de ignorar grupo

Mudar `groups: false` no código não avisa sozinho uma sessão que já está
conectada — o WAHA só reconverge a config quando a sessão passa por
`start`/reconexão de novo (e isso reinicia a sessão por alguns segundos, sem
precisar reescanear o QR). Mais simples: na tela do CRM, **Central de
Conexões → seu número → Reconectar**. Depois disso, mensagens de grupo passam
a chegar.

### 5. Testar

1. Mande uma mensagem num grupo do WhatsApp em que o número conectado esteja.
2. Confira se a conversa aparece no Inbox com o selo **Grupo**.
3. Responda pelo CRM e confirme que chega no grupo de verdade.
4. Confira que o grupo **não** aparece no Kanban nem gera lead — é o
   comportamento esperado.

## Uma limitação conhecida (não bloqueia nada)

O nome do grupo não vem no payload da mensagem — só a própria API do WAHA
sabe, e não fui atrás dela para manter esta entrega mais simples e com menos
pontos de falha. Por isso, na primeira vez, o grupo aparece com um rótulo
genérico tipo "Grupo 000001" (os últimos dígitos do id). Para dar um nome de
verdade, edite o contato do grupo pela ficha, como qualquer outro contato —
o nome que você digitar fica valendo. Se um dia quiser que o nome venha
sozinho, dá para buscar via API do WAHA — é um passo a mais que deixei de
fora de propósito.

## Se algo der errado

`bash hostgator-setup-kit/restore.sh backups/db-<data>.sql.gz` volta o banco
ao estado do último backup (faça um backup antes do passo 2, se quiser
margem extra: `bash hostgator-setup-kit/backup.sh`). Para reverter só o
código: `git revert 99d25d9` (o commit deste patch, `git log --oneline -1`
confere) e rebuild de novo.
