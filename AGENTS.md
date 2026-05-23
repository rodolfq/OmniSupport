# Diretrizes do Projeto: OmniSupport

## 🚨 CRITICAL: ESTABILIDADE E PERSISTÊNCIA
Este projeto utiliza uma arquitetura baseada em Next.js 15 e Supabase. 
**NUNCA** realize refactors globais que alterem a estrutura de pastas ou removam arquivos sem solicitação explícita do usuário.

## Stack Técnica
- **Frontend**: Next.js 15 (App Router), Tailwind CSS v4, Motion (animações).
- **Backend/DB**: Supabase (Database, Auth, Storage).
- **Comunicação**: WhatsApp via Baileys (verificar `node_modules`).

## Prevenção de Perda de Dados
- **Arquivos**: Todos os arquivos enviados por usuários DEVEM ser salvos no Supabase Storage. O sistema de arquivos local do container é efêmero e limpo em cada rebuild.
- **Estado**: O estado da aplicação deve ser persistido integralmente no Supabase.
- **Migrations**: Utilize os arquivos SQL na raiz (`schema.sql`, `supabase_schema.sql`) como fonte de verdade para a estrutura do banco.

## Instruções de Manutenção
1. Antes de qualquer alteração, leia o `firebase-blueprint.json` (se existir) ou os esquemas SQL.
2. Ao atualizar o layout, preserve os componentes existentes em `components/` e `app/(portal)/`.
3. Garanta que as variáveis de ambiente (`.env.example`) estejam sempre documentadas.
