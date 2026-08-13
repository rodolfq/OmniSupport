# Diretrizes do Projeto: OmniSupport

## 🚨 CRITICAL: ESTABILIDADE E PERSISTÊNCIA
Este projeto utiliza uma arquitetura baseada em Next.js 15 e Supabase. 
**NUNCA** realize refactors globais que alterem a estrutura de pastas ou removam arquivos sem solicitação explícita do usuário.

## Stack Técnica
- **Frontend**: Next.js 15 (App Router), Tailwind CSS v4, Motion (animações).
- **Backend/DB**: Supabase (Database, Auth, Storage).
- **Comunicação**: WhatsApp via Baileys (verificar `node_modules`).

## Prevenção de Perda de Dados
> As três linhas abaixo estavam DESATUALIZADAS e foram corrigidas: o projeto
> não usa Supabase como backend desde a migração para Postgres próprio. Seguir
> a versão antiga levava a decisões erradas sobre onde gravar arquivo e estado.

- **Arquivos**: anexos vão para o volume apontado por `ATTACHMENTS_DIR`
  (`/data/attachments` no container), gravados por
  `lib/services/attachment-storage.ts` e servidos por `/api/files/...`.
  **Não** existe Supabase Storage neste projeto.
- **Estado**: tudo é persistido no PostgreSQL próprio (`DATABASE_URL`), via SQL
  puro com o driver `pg`. O único estado fora do banco são os anexos no volume.
- **Migrations**: a fonte de verdade é `schema_postgres.sql`, com as mudanças
  incrementais em `migrations/*.sql` aplicadas por `scripts/run-migrations.js`.
  (`supabase_schema.sql` foi removido do repositório — estava desatualizado e
  descrevia um backend que não existe mais.)

## Instruções de Manutenção
1. Antes de qualquer alteração, leia o `firebase-blueprint.json` (se existir) ou os esquemas SQL.
2. Ao atualizar o layout, preserve os componentes existentes em `components/` e `app/(portal)/`.
3. Garanta que as variáveis de ambiente (`.env.example`) estejam sempre documentadas.
