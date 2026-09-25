#!/usr/bin/env bash
# Aplica a migration 0409 (grupos do WhatsApp) no banco JÁ instalado.
#
# A rotina normal de atualização (rebuild + `docker compose up -d`) não
# reaplica schema — só troca a imagem do app. Esta migration é nova e precisa
# rodar uma vez, direto no banco, do mesmo jeito que backup.sh/restore.sh já
# falam com ele: por `url_do_schema` (a conexão de DONO do schema, não a do
# app) e por um `psql` efêmero na mesma rede (`pg_container`) — nunca por uma
# porta pública, que não existe no modo single-server.
#
#   cd ~/DeskcommCRM-novo && bash hostgator-setup-kit/aplicar-migration-grupos.sh
source "$(dirname "$0")/_common.sh"
enter_project

MIGRATION="$PROJECT_DIR/supabase/migrations/20260924230532_0409_grupos_whatsapp_no_crm.sql"
[ -f "$MIGRATION" ] || die "Não achei $MIGRATION — confira se o patch foi aplicado (git am) antes de rodar isto."

step "Aplicando a migration de grupos do WhatsApp"
# psql_run NÃO serve aqui: ela roda o psql dentro de um contêiner efêmero que
# não enxerga o filesystem do host, então um "-f <caminho do host>" dá "No
# such file or directory" dentro do contêiner mesmo com o arquivo existindo
# aqui fora. É por isso que reaplicar_baseline() (_common.sh) monta o arquivo
# como volume em vez de usar psql_run — mesmo padrão aqui.
if pg_container -i -v "$MIGRATION:/migration.sql:ro" postgres:17-alpine \
     psql "$(url_do_schema)" -v ON_ERROR_STOP=1 -f /migration.sql; then
  c_grn "✓ migration aplicada — grupos já podem virar conversa no CRM"
else
  die "A migration falhou — confira a saída acima antes de seguir para o rebuild."
fi
