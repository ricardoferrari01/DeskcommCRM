# DeskcommCRM — runbook de atualização (fork ricardoferrari01)

Referência rápida para manter a instalação em `crmwhatsapp.srsdigitalpersonalizados.com` sincronizada com o projeto original, no seu ritmo.

## Onde tudo está

- **Instalação em produção:** `~/DeskcommCRM-novo` — self-hosted (Postgres, Auth, Storage e Realtime próprios, rodando na mesma VPS, sem depender do plano do Supabase Cloud).
- **Instalação antiga:** `~/DeskcommCRM` — parada, mantida como rede de segurança. Pode ser apagada quando você tiver confiança de que não vai precisar mais dela.
- **Backups:** `~/DeskcommCRM-novo/backups/`.

## Sincronizar o fork com o projeto original

Faça isso no ritmo que preferir (semanal ou mensal):

```bash
cd ~/DeskcommCRM-novo
git fetch upstream
git log HEAD..upstream/main --oneline   # veja o que mudou antes de trazer
git merge upstream/main                # ou: git rebase upstream/main
```

Se você tiver feito alterações próprias no código, resolva os conflitos de merge normalmente nessa hora.

## Backup antes de qualquer atualização

```bash
cd ~/DeskcommCRM-novo
bash hostgator-setup-kit/backup.sh
```

Vale colocar isso num cron diário (`crontab -e`):

```
0 3 * * * cd ~/DeskcommCRM-novo && bash hostgator-setup-kit/backup.sh
```

## Rebuildar as imagens a partir do seu código e subir

```bash
cd ~/DeskcommCRM-novo
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build
docker compose -f docker-compose.prod.yml -f docker-compose.single-server.yml -f docker-compose.build.yml up -d
bash hostgator-setup-kit/healthcheck.sh
```

O build leva de 15 a 25 minutos — rode em segundo plano com `nohup ... &` numa VPS por SSH, já que a conexão pode cair no meio.

## Se algo quebrar depois de atualizar

```bash
cd ~/DeskcommCRM-novo
bash hostgator-setup-kit/restore.sh backups/db-<data>.sql.gz
```

## Comandos do dia a dia

| O que fazer | Comando |
|---|---|
| Ver logs do app | `docker compose -f docker-compose.prod.yml -f docker-compose.single-server.yml logs -f app` |
| Reiniciar tudo | `docker compose -f docker-compose.prod.yml -f docker-compose.single-server.yml restart` |
| Diagnóstico geral | `bash hostgator-setup-kit/healthcheck.sh` |

## Pendências cosméticas (não urgentes)

- **E-mails de acesso:** o Supabase self-hosted ainda não usa o modelo de e-mail do próprio CRM para confirmação/recuperação de senha. Se isso incomodar, adicione ao serviço `auth` do Supabase (dentro de `~/DeskcommCRM-novo/.runtime/supabase/.env`):
  ```
  GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://crmwhatsapp.srsdigitalpersonalizados.com/email-templates/confirmation
  GOTRUE_MAILER_TEMPLATES_RECOVERY=https://crmwhatsapp.srsdigitalpersonalizados.com/email-templates/recovery
  ```
  e reinicie o `auth` do Supabase.
- **Kernel pendente:** a VPS avisou sobre uma atualização de kernel esperando reboot. Não é urgente, mas vale agendar um reboot num horário tranquilo.
