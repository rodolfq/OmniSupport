# Refatoração para Produção - Plano de Execução

## Objetivo
Eliminar MockDB e usar 100% Supabase direto com real-time.

## Arquivos de Serviço Criados
- [x] `lib/services/user-service.ts` - Operações de usuário
- [x] `lib/services/company-service.ts` - Operações de empresa
- [x] `lib/services/ticket-service.ts` - Operações de ticket
- [x] `lib/services/chat-service.ts` - Operações de chat
- [x] `lib/services/config-service.ts` - Configurações

## Passos Restantes (Executar em Ordem)

### 1. Atualizar app-context.tsx
- Remover MockDB.syncFromSupabase() 
- Usar UserService e ChatService diretamente
- Manter realtime via canais Supabase

### 2. Atualizar Components
- `components/ticket-detail-modal.tsx` → TicketService, MessageService
- `components/new-ticket-modal.tsx` → CompanyService, UserService, ConfigService
- `components/chat-widget.tsx` → ChatService, UserService
- `components/edit-employee-modal.tsx` → UserService
- `components/link-contact-modal.tsx` → UserService, CompanyService, ChatService
- `components/status-history-panel.tsx` → UserStatusHistoryService, AbsenceReasonService
- `app/(portal)/settings/page.tsx` → ConfigService
- `app/(portal)/tickets/page.tsx` → TicketService
- `app/(portal)/customers/page.tsx` → ChatService

### 3. Remover MockDB
- Deletar `lib/mock-db.ts`
- Remover imports e referências

### 4. Validações
- Testar login/logout
- Testar criação de tickets/chamados
- Testar chat em tempo real

## SQL a Executar no Supabase
```sql
-- Executar missing_rpcs_and_fixes.sql para:
-- 1. Recriar funções RPC
-- 2. Corrigir funcionários sem empresa
```