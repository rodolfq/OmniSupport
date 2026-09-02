# CLAUDE.md

Este arquivo orienta o Claude Code (e qualquer novo desenvolvedor) a trabalhar neste repositório sem precisar perguntar o básico. Tudo aqui foi extraído do código real (`package.json`, `schema_postgres.sql`, rotas em `app/api/`, `middleware.ts`, `lib/`, `.env`, histórico de commits). Pontos que não puderam ser confirmados com certeza estão marcados com ⚠️ **A CONFIRMAR**.

---

## 1. Visão geral

**SSX Desk** (nome interno do pacote: `ssx-desk`; nome do produto anterior era "OmniSupport", ainda usado no nome da pasta/projeto) é uma plataforma de helpdesk/atendimento ao cliente multicanal.

- **Usuários finais**: equipe de suporte (analistas/"Equipe"), administradores, "Time Interno" (times de dev/infra/QA/produto que abrem tickets internos), e clientes/funcionários de empresas-cliente que abrem chamados e conversam via chat.
- **Problema que resolve**: centraliza chamados de suporte (tickets), chat ao vivo com clientes (via WhatsApp e via widget do portal), gestão de filas/atendentes, base de conhecimento operacional (notas rápidas), avaliação de clientes, automação de mensagens, e um sistema interno de tickets/hotfixes para o próprio time de desenvolvimento.
- Roda como aplicação Next.js num container Docker (processo único e contínuo), com PostgreSQL próprio (não é um BaaS Supabase real, ver seção 15).

---

## 2. Stack e versões

Extraído de `package.json`:

| Camada | Tecnologia | Versão |
|---|---|---|
| Linguagem | TypeScript | ^5.6.3 |
| Framework | Next.js (App Router) | 15.5.15 |
| UI | React / React DOM | ^19.0.0 |
| Estilo | Tailwind CSS | ^4.0.0 (`@tailwindcss/postcss`) |
| Animações | `motion` (Framer Motion) | ^11.11.11 |
| Editor de texto rico | Tiptap (`@tiptap/react` + extensões) | ^3.23.1 |
| Drag & drop | `@dnd-kit/*` | ^6 / ^10 / ^3 |
| Banco de dados | PostgreSQL via driver `pg` | ^8.20.0 |
| ORM | **Nenhum** — SQL puro via `pg.Pool` (ver seção 6) | — |
| Auth | JWT próprio (Web Crypto, HMAC-SHA256) + cookie httpOnly | — |
| WhatsApp não-oficial | `@whiskeysockets/baileys` | ^7.0.0-rc.9 |
| WhatsApp oficial | Meta Cloud API (webhook HTTP, sem SDK) | — |
| Push notifications | `web-push` (VAPID) | ^3.6.7 |
| Transcrição de áudio | `@huggingface/transformers` (Whisper local) + `ffmpeg-static` | ^4.2.0 |
| Gráficos | `recharts` | ^2.13.3 |
| PDF/ZIP | `jspdf`, `jszip` | ^4.2.1 / ^3.10.1 |
| Notificações UI | `sonner` | ^2.0.7 |
| Logs | `pino` | ^8.21.0 |
| Lint | ESLint (`next lint`, flat config) | ^9.39.4 |

**Pacotes Supabase presentes mas não usados como backend real** (`@supabase/supabase-js`, `@supabase/ssr`) — ver seção 15 "Decisões e armadilhas".

---

## 3. Como rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
# Não existe .env.example no repositório (⚠️ A CONFIRMAR se deveria existir).
# Copie a estrutura da tabela da seção 4 para um arquivo .env na raiz.

# 3. Banco de dados: aplicar o schema
# schema_postgres.sql é a fonte de verdade (contém DROP TABLE + CREATE + seeds).
# Rodar contra o Postgres apontado por DATABASE_URL, ex.:
psql "$DATABASE_URL" -f schema_postgres.sql

# 4. (Opcional) aplicar migrations incrementais que vieram depois do schema base
# Todas em migrations/*.sql — não há runner automático, cada uma é aplicada
# manualmente uma vez (ver seção 11 sobre produção).

# 5. Rodar em desenvolvimento
npm run dev
# Next.js sobe na porta padrão 3000 (http://localhost:3000)

# Outros scripts
npm run build   # roda check:encoding (scripts/check-encoding.js) antes do build
npm run start   # produção, após build
npm run lint    # next lint
```

**Login de desenvolvimento**: o `schema_postgres.sql` semeia um usuário administrador (`admin@systemsat.com.br`) e um cliente de teste (`jose@cliente.com`). As senhas **não ficam documentadas** aqui nem no schema: as mesmas contas existem no banco de produção, e este repositório é versionado — publicar a senha equivale a publicar acesso de administrador. Peça a credencial a quem administra o ambiente.

⚠️ **A CONFIRMAR**: se o Postgres de `DATABASE_URL` no `.env` atual é um banco compartilhado de produção/staging ou um ambiente pessoal — o schema faz `DROP TABLE ... CASCADE` no topo, então **nunca rodar `schema_postgres.sql` contra um banco com dados reais**.

---

## 4. Variáveis de ambiente

Não há `.env.example`. Nomes abaixo extraídos de `.env` (valores reais omitidos) e de uso no código (`lib/db.ts`, `lib/jwt.ts`, `lib/supabase/server.ts`, `app/api/create-user/route.ts`).

| Variável | Para que serve | Obrigatória | Onde obter |
|---|---|---|---|
| `DATABASE_URL` | Connection string do PostgreSQL (usada por `lib/db.ts` e `lib/whatsapp-db.ts`) | Sim | Provedor do banco Postgres da equipe |
| `JWT_SECRET` | Chave HMAC para assinar/validar o cookie de sessão (`lib/jwt.ts`) | Sim (tem fallback inseguro hardcoded se ausente — **trocar em produção**) | Gerar string aleatória longa |
| `VAPID_PUBLIC_KEY` | Chave pública Web Push (notificações mesmo com app fechado) | Sim para push funcionar | Gerar via `web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Chave privada Web Push | Sim para push funcionar | Idem, mantida em segredo |
| `VAPID_SUBJECT` | `mailto:` de contato exigido pelo protocolo VAPID | Sim para push funcionar | E-mail de contato da equipe |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Mesma chave pública, exposta ao client para `subscribe()` | Sim para push funcionar | Deve ser igual a `VAPID_PUBLIC_KEY` |
| `ENABLE_AUDIO_TRANSCRIPTION` | Liga/desliga transcrição de áudio local (Whisper) no servidor | Não (default desligado se ausente) | `true`/`false` — baixa ~150MB de modelo (vai pro volume `models`) e precisa de ffmpeg; é CPU-bound no mesmo container que atende as requisições |
| `NEXT_PUBLIC_ENABLE_AUDIO_TRANSCRIPTION` | Mostra/esconde o botão de transcrição no client | Não | Deve ficar sempre igual a `ENABLE_AUDIO_TRANSCRIPTION` |
| `TRANSCRIPTION_MODEL` | Nome do modelo Whisper usado (`@huggingface/transformers`) | Não (default no código) | Ex.: `Xenova/whisper-base` |
| `GROQ_API_KEY` | Chave da API do Groq usada pelo widget do Agente de IA (`lib/services/ai-assistant-service.ts`) | Sim, para o Agente de IA funcionar | [console.groq.com/keys](https://console.groq.com/keys) — tier gratuito real, sem cartão; trocado no lugar do Gemini porque o projeto Google Cloud da chave veio com cota gratuita zerada |
| `GROQ_MODEL` | Nome do modelo Groq usado pelo Agente de IA | Não (default `openai/gpt-oss-120b` no código, ver `lib/groq-client.ts`; pode ser sobrescrito também em Configurações > Agente de IA, que tem prioridade sobre esta env var) | Lista de modelos atuais em [console.groq.com/docs/models](https://console.groq.com/docs/models) — a Groq descontinua modelo de tempos em tempos (`llama-3.3-70b-versatile` caiu em 06/2026), o sintoma é a IA responder erro 404 `model_not_found` |
| `ENABLE_AI_EMBEDDINGS` | Liga/desliga a busca semântica do Agente de IA (embeddings locais, `lib/services/embedding-service.ts`) e o scheduler que drena a fila de indexação (`lib/services/embedding-scheduler.ts`) | Não (default desligado se ausente) | `true`/`false` — mesmo custo do `ENABLE_AUDIO_TRANSCRIPTION` (baixa modelo, CPU-bound); ligar só quando a máquina tiver CPU sobrando |
| `EMBEDDING_MODEL` | Nome do modelo de embedding usado (`@huggingface/transformers`) | Não (default no código) | Ex.: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` |
| `ENABLE_DISSATISFACTION_DETECTOR` | Liga/desliga o scheduler que classifica insatisfação do cliente em chats encerrados (`lib/services/dissatisfaction-service.ts` + `dissatisfaction-scheduler.ts`), gerando resumo + departamento/categoria via Groq | Não (default desligado se ausente) | `true`/`false` — diferente de `ENABLE_AI_EMBEDDINGS`/`ENABLE_AUDIO_TRANSCRIPTION` (que são sobre CPU/serverless), esta flag é proteção de **cota**: é a única chamada automática (sem pedido humano) à mesma chave de teste do `GROQ_API_KEY`, já apertada pelo Agente de IA — ligar só depois de confirmar que sobra cota |
| `BITRIX24_WEBHOOK_URL` | URL do webhook de entrada do Bitrix24, usada pra sincronizar usuários internos (equipe) — `lib/services/bitrix24-service.ts`. O sync de empresas (CRM) que também usava esta variável foi removido em 2026-09-01 (ver Planilha de CS, seção 10) | Sim, para o botão "Sincronizar Bitrix24" na tela Gestão da Equipe funcionar | Bitrix24 > Aplicativos > Webhooks > Webhook de entrada — formato `https://SEUDOMINIO.bitrix24.com.br/rest/1/xxxxxxxx/` (precisa de permissão de leitura em `user`) |
| `GOOGLE_CLIENT_ID` | Client ID OAuth2 usado pela integração pessoal de Google Agenda (`lib/services/google-calendar-service.ts`) — cada usuário vincula a própria conta, só leitura | Sim, para o botão "Vincular Google Agenda" (Configurações > Notificações) funcionar | [console.cloud.google.com](https://console.cloud.google.com) > criar projeto > APIs e Serviços > Credenciais > "ID do cliente OAuth" tipo "Aplicativo da Web", com a Google Calendar API ativada. Registrar como URI de redirecionamento autorizado: `https://SEUDOMINIO/api/integrations/google-calendar/callback` (um por domínio/ambiente que for usar o vínculo) |
| `GOOGLE_CLIENT_SECRET` | Client Secret do mesmo cliente OAuth2 acima | Sim, idem | Mesma tela do `GOOGLE_CLIENT_ID`, mantido em segredo |
| `GOOGLE_REDIRECT_URI` | URL de callback explícita, sobrepõe a dedução automática (protocolo+host da própria requisição) | **Sim, na prática** — descoberto em 2026-08-26: rodando em standalone dentro do Docker, o host que chega na requisição vem como `0.0.0.0:3000` em vez do host real (`localhost:3000` em dev, o domínio público em produção), mesmo acessando por outro nome no navegador. Sem esta variável setada, o Google recusa o OAuth com `Error 400: invalid_request` (aparece `redirect_uri=http://0.0.0.0:...` nos "detalhes técnicos" da tela de erro do Google) | Definir sempre, com a URL pública real de callback (`.../api/integrations/google-calendar/callback`) cadastrada como URI de redirecionamento autorizado no mesmo Client ID do Google Cloud Console |
| `NODE_ENV` | Next.js padrão; controla `secure` do cookie de sessão | Implícita | Definida pelo runtime |
| `HF_HOME` | Diretório de cache dos modelos do `@huggingface/transformers` (Whisper e embeddings) | Não (default do runtime, `~/.cache/huggingface`) | No container é fixada em `/data/models`, apontando pro volume `models` (ver `docker-compose.yml`) — sem isso cada restart rebaixa ~150MB por modelo |
| `ATTACHMENTS_DIR` | Diretório onde os anexos de chamado/chat são gravados (`lib/services/attachment-storage.ts`) | Não (default `./data/attachments`, para desenvolvimento) | No container é `/data/attachments`, apontando pro volume `attachments` — **é o único estado da aplicação fora do Postgres, entra no backup** |

### Separação front/back (todas opcionais — vazias = deploy de um container só)

Definidas em `lib/runtime-config.ts`. Enquanto não forem preenchidas, o sistema
se comporta exatamente como o monolito de hoje: as chamadas do navegador ficam
relativas, CORS não entra em ação e os jobs sobem normalmente.

| Variável | Para que serve | Obrigatória | Onde obter |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Endereço da API que o **navegador** chama (ex.: `https://api.empresa.com`). Vazia = mesma origem da página | Só no deploy separado, **na imagem do front** | **É build arg**, não runtime — precisa estar no `build.args` do `docker-compose.split.yml`; definir só em `env_file` não tem efeito e a falha é muda |
| `SERVICE_ROLE` | `monolith` (padrão) / `backend` / `frontend`. Decide quem sobe schedulers e WhatsApp | Não | Definida no compose, por serviço — o container do front **não** pode subir jobs, senão mensagem automática sai duplicada |
| `CORS_ALLOWED_ORIGINS` | Origens que o back aceita com cookie, separadas por vírgula | Só no deploy separado, no back | Origem exata do front, com esquema e sem barra final. Curinga `*` não funciona com credenciais |
| `COOKIE_DOMAIN` | Domínio do cookie de sessão (ex.: `.empresa.com`) | Só quando front e back estão em hosts diferentes | Domínio pai comum aos dois subdomínios |
| `COOKIE_SAMESITE` | `lax` (padrão) ou `none` | Só entre domínios **diferentes** | `none` exige HTTPS nos dois lados |

Se `NEXT_PUBLIC_API_URL`, `CORS_ALLOWED_ORIGINS` e `COOKIE_DOMAIN` divergirem
entre si, o sintoma é sempre o mesmo e engana: tudo responde **401** e a tela
volta ao login, como se a senha estivesse errada.

Variáveis referenciadas no código mas **ausentes do `.env` atual** (endpoints órfãos, ver seção 14):

| Variável | Onde é usada | Situação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/server.ts`, `app/api/create-user/route.ts` | Só usada por código morto/não roteado — ⚠️ **A CONFIRMAR** se deve ser removida junto do código |
| `SUPABASE_SERVICE_ROLE_KEY` | `app/api/create-user/route.ts` | Idem |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/server.ts` | Idem |

---

## 5. Estrutura de pastas

```
app/
  (portal)/            # Rotas autenticadas do portal (route group, sem prefixo na URL)
    layout.tsx          # Shell: sidebar, header, chat widget, modais globais, mobile nav
    dashboard/          # Dashboard analítico (bloqueado p/ Cliente/Funcionário)
    tickets/[id]/       # Lista e detalhe de chamados
    my-tickets/         # Chamados do próprio usuário (Cliente/Funcionário)
    customers/[id]/     # CRM: empresas-cliente + tela dedicada por empresa
    chat/                # Chat ao vivo (atendimento)
    chat-management/     # Painel/fila de chats do WhatsApp+widget ("Central de Atendimento")
    chat-history/        # Histórico de conversas encerradas
    chat-internal/        # Chat interno da equipe (grupos/DM)
    internal-tickets/[id]/ # Tickets internos do time de dev/infra/QA/produto
    team/, permissions/    # Gestão de equipe e Perfis de Acesso (RBAC)
    queues/               # CRUD de Filas + estratégia de distribuição (roteamento de conversas — NÃO confundir com giro/)
    giro/                 # Giro de Atendimento: rodízio diário da equipe (quem pega o próximo atendimento), 2 abas (dia + configuração)
    hotfixes/             # Cadastro de hotfix / janela de release
    reports/, customer-evaluations/ # Relatórios e avaliações de cliente
    settings/             # Configurações gerais (status, categorias, produtos, WhatsApp, etc.)
    whatsapp/             # Conexão/QR code do WhatsApp não-oficial
    activities/           # ⚠️ A CONFIRMAR propósito exato (não inspecionado a fundo)
  api/                  # Route handlers (ver seção 8) — maioria multiplexada por ?action=
  login/                # Página de login (pública)
  actions.ts            # Server Actions (mutações principais: usuários, tickets, permissões)
  app-context.tsx        # Contexto React global (usuário logado, notificações, realtime)
  layout.tsx / globals.css / theme-provider.tsx

components/            # Componentes de UI, todos "flat" (sem subpastas) — ver seção 9
hooks/                  # Hooks React reutilizáveis (mobile, push, transcrição)
lib/
  services/              # Camada de acesso a dados/regra de negócio por domínio (ver seção 6)
  db.ts                  # Pool pg principal (DATABASE_URL)
  whatsapp-db.ts          # Pool pg separado, dedicado à sessão do WhatsApp
  supabase/server.ts       # Cliente Supabase real (ssr) — código órfão, não usado no fluxo atual
  supabase-auth.ts         # Persistência de credenciais Baileys no Postgres (nome legado)
  jwt.ts / auth-utils.ts    # Sessão (JWT via Web Crypto) e hash de senha (PBKDF2)
  types.ts                  # Única fonte de tipos de domínio (Ticket, User, Permission, etc.)
  nav-items.ts              # Árvore de navegação + regra de visibilidade por permissão
  chat-events.ts             # Fan-out de eventos em tempo real (SSE), em memória por processo
  audit-log.ts, sla.ts, ticket-status.ts, ticket-diff.ts, integration-auth.ts, ...
middleware.ts           # Gate de autenticação global (JWT em cookie) para toda a app
instrumentation.ts / instrumentation-node.ts # Boot: reconecta WhatsApp, inicia schedulers
migrations/             # SQL incremental aplicado manualmente em produção (ver seção 11)
schema_postgres.sql     # Schema completo + seeds — fonte de verdade do banco
                        # (supabase_schema.sql foi REMOVIDO em 2026-08-13:
                        #  estava desatualizado e descrevia um backend Supabase
                        #  que não existe mais neste projeto)
scripts/diagnostics/     # Scripts SQL/TS ad-hoc de debug — não fazem parte do fluxo oficial
public/                 # Ícones, manifest PWA, service worker (sw.js)
manuais/                # HTML/PDF — organizados em subpastas por tipo
  usuario/               # Manuais do usuário final (admin, funcionário, desenvolvedor/time interno)
  tecnico/                # Guias técnicos/DevOps (ex.: guia-implementacao-servidor)
  roadmap/                # ROADMAP_MELHORIAS*.md/.pdf e RESUMO_ROADMAP*.pdf (movidos da raiz)
  assets/                 # manual.css compartilhado por tudo acima (referenciado como ../assets/manual.css)
```

---

## 6. Modelo de dados

Fonte de verdade: [`schema_postgres.sql`](schema_postgres.sql). Desde 2026-08-13 ele está **alinhado com produção** e provisiona um banco novo de verdade (verificado contra um Postgres descartável: 51 tabelas dos dois lados, zero diferença). `supabase_schema.sql` foi removido.

Não há ORM/migration framework — todo acesso é SQL puro via `pg` (ver `lib/db.ts` e os arquivos em `lib/services/`).

### Entidades principais

- **`companies`** — empresas-cliente. Campo `is_in_training` (⚠️ A CONFIRMAR se está em `schema_postgres.sql` — presente no tipo `Company` de `lib/types.ts`, checar coluna real antes de depender dela). `cs_responsavel_id`/`comercial_responsavel_id` apontam pra `profiles` (usuário da equipe). `id_central` (adicionada em 2026-09-01) é o id do cliente no sistema "Central" (rastreamento/telemetria), vindo da Planilha de CS — **não é único**: duas empresas podem compartilhar o mesmo `id_central` quando são marcas/CNPJs diferentes na mesma conta central (confirmado nos dados reais da planilha). `decisor_nome`/`decisor_telefone` (adicionadas em 2026-09-02) são TEXT simples — contato decisor na empresa-cliente, também vindo da Planilha de CS, editável no cadastro mas sempre reescrito pela sync seguinte quando a célula da planilha não estiver vazia.
- **`profiles`** — usuário do sistema (interno E cliente, tabela única). `role` é estrutural (`Administrador`, `Equipe`, `Cliente`, `Funcionário`, `Time Interno`) e **não decide mais permissões** — quem decide é `access_profile_id` → `role_permissions.permissions`. Campos-chave: `company_id`, `internal_team_ids[]`, `access_profile_id`, `must_change_password`, `view_all_company_tickets`, `lives_in_squad`.
- **`role_permissions`** ("Perfil de Acesso" na UI) — array `permissions text[]` (valores do enum `Permission` em `lib/types.ts`). `internal_team_id` NULL = perfil global; preenchido = perfil escopado a uma equipe interna (admin de equipe só edita perfis da própria equipe).
- **`internal_teams`** — equipes internas (Desenvolvimento, Infra, QA, Produto). `admin_ids uuid[]` define quem administra a equipe (pode criar usuários/perfis escopados a ela).
- **`tickets`** (chamados) — `id` é `TEXT` (md5, não UUID puro), `public_ticket_number` sequencial (`ticket_seq`, começa em 1000). Campos de negócio: `status`, `sub_status` (opcional, aponta para `config_statuses.parent_status_id`), `priority`, `category` (**legado**, mantido só para compat de integrações externas), `category_id`/`request_type_id`/`product_id` (modelo atual, ver `config_*`), `tags text[]`, `queue_id`, `chat_session_id` (conversa de origem, N:1), `merged_into_id` (mesclagem — chamado absorvido aponta pro sobrevivente).
- **`ticket_messages`** — mensagens do chamado (`type`: `text`/`system`/`internal`/`system_log`; `is_visible_to_customer` separa nota interna de resposta ao cliente); `attachments_data jsonb`.
- **`chat_sessions`** / **`chat_messages`** — chat ao vivo (WhatsApp ou widget logado). `status`: `waiting`/`active`/`closed`. `chat_messages.type` inclui `text`/`system`/`internal`/`file`/`image`/`gif`/`sticker`; `metadata jsonb` guarda anexos, menções, reações.
- **`chat_histories`** — snapshot de uma conversa encerrada (rating -1/0/1 da pesquisa de satisfação, `transcript`, duração, tempo de primeira resposta). Indexado por `customer_phone` para histórico "sob demanda".
- **`chat_session_viewers`** — quem está olhando uma conversa agora (usado para não enviar push a quem já está vendo; persistido no banco para não depender da memória de um processo específico).
- **`internal_tickets`** — tickets do time de dev/infra. `id` formatado tipo `int-0001` na UI, `internal_ticket_number` sequencial próprio. `hotfix_id` liga a um hotfix; `sla_limit` calculado a partir da prioridade + `config_priorities`.
- **`ticket_internal_links`** — N:N entre `tickets` e `internal_tickets`.
- **`hotfixes`** — nome, responsável, `expected_date`, `published_at`, `alerted_at` (alerta automático de prazo vencido).
- **`whatsapp_sessions`** — credenciais Baileys persistidas linha a linha (chave `id`, `data jsonb`) — ver `lib/supabase-auth.ts` (nome legado, não usa Supabase de fato).
- **`whatsapp_instances`** — instâncias configuráveis de WhatsApp (múltiplos números).
- **`whatsapp_contact_photos`** — cache de foto de contato por instância+telefone.
- **`queues`** — fila de atendimento. `whatsapp_instance_id`, `member_ids uuid[]`, `include_internal_chats` (participa do pool de chats do widget), `routing_strategy` (`round_robin` | `daily_balance`).
- **`internal_chats`** / **`internal_chat_messages`** — chat interno da equipe (grupos/DM); `internal_chats` guarda `pinned_by`, `muted_by`, `hidden_by`, `read_later_by` como arrays de `uuid`.
- **`config_statuses`** — status configuráveis por `scope` (`ticket` | `internal_ticket`), com `is_closed`, `sort_order`, `parent_status_id` (sub-status).
- **`config_categories`**, **`config_request_types`**, **`config_products`**, **`config_priorities`** (com `sla_hours`), **`config_tags`** (com `domain`: `ticket`/`chat`) — todas listas configuráveis simples, mesmo padrão de CRUD.
- **`automation_settings`** / **`automation_dispatches`** — catálogo de 11 eventos de mensagem automática (definidos em `lib/automation-events.ts`) + fila/histórico de disparo.
- **`audit_log`** — log de alterações (`action`: create/update/delete/publish), nunca lança erro (`lib/audit-log.ts`).
- **`analyst_status`**, **`user_status_history`**, **`absence_reasons`** — presença/status do analista (online/ausente) e histórico.
- **`quick_notes`**, **`saved_views`**, **`user_search_history`** — produtividade do analista.
- **`integration_api_keys`** — chaves da API de integração externa (ver seção 8).
- **`giro_participants`**, **`giro_days`**, **`giro_day_rows`**, **`giro_history`**, **`giro_checklist_items`** — Giro de Atendimento (`migrations/giro_atendimento.sql`, `lib/services/giro-service.ts`): rodízio diário de quem pega o próximo atendimento. NÃO confundir com `queues` — Fila distribui a conversa que chega, Giro é a ordem em que a equipe se reveza para atender. `giro_participants` é o cadastro (posição fixa/livre, fora do rodízio, ausência com prazo); `giro_days`/`giro_day_rows` são a ordem gerada por data (no máximo uma por dia, `UNIQUE(giro_date)`); `giro_history` é o que já foi concluído no dia.

### Enums/valores fixos (em `lib/types.ts`, não em `enum` do Postgres — Postgres usa `TEXT`)

- `UserRole`: `Administrador`, `Equipe`, `Cliente`, `Funcionário`, `Time Interno`.
- `TicketStatus` (default): `Novo`, `Em Atendimento`, `Aguardando Cliente`, `Fechado` — mas a lista real e editável vive em `config_statuses` (não travar em union fixo).
- `TicketPriority`: `Baixa`, `Média`, `Alta`, `Urgente`.
- `Permission`: ver lista completa em `lib/types.ts:18-51` (ex.: `tickets:read`, `tickets:outside_queue`, `internal:view_all`, `whatsapp:manage`, `queues:manage`, `hotfixes:manage`).

---

## 7. Fluxos principais

### Autenticação/sessão
1. `POST /api/auth/login` (`app/api/auth/login/route.ts`) — verifica senha (PBKDF2, `lib/auth-utils.ts`), busca `permissions` via `role_permissions`, soma bônus de "admin de equipe" (`team:read`+`settings:write`), assina JWT (`lib/jwt.ts`, HMAC-SHA256 via Web Crypto) e grava em cookie httpOnly `token` (1 dia).
2. `middleware.ts` roda em **toda** requisição (exceto assets estáticos e `PUBLIC_PATHS`/`PUBLIC_PREFIXES`): valida só assinatura + expiração do JWT (sem round-trip ao banco). Não decide autorização fina — isso fica em cada Server Action/rota.
3. `GET /api/auth/me` — resolve o usuário atual a partir do cookie.
4. `POST /api/auth/logout` — limpa cookie.
5. `POST /api/auth/change-password` — troca de senha (inclusive fluxo de "senha provisória" via `must_change_password`, ver `components/force-password-change.tsx`).

### Criação de chamado
- Server Action `saveTicketFromChatSession` (`app/actions.ts`) — cria um `ticket` a partir de uma `chat_session` (parâmetro `forceNew` permite múltiplos chamados na mesma conversa).
- `POST /api/tickets?action=create` — criação direta (fora do fluxo de chat), via `components/new-ticket-modal.tsx` → `TicketService`.
- Duplicação/mesclagem: `mergeTickets`/`duplicateTicket` (`app/actions.ts`), escrita SQL direta — **não** passam pelo PATCH normal, não disparam automação nem notificam o cliente.

### Atribuição / distribuição por fila
- `lib/services/queue-routing.ts` (`pickNextQueueAssignee`) — round-robin ou `daily_balance` entre membros online da fila (`queues.member_ids` ∩ `analyst_status.is_online`). Pool combinado entre filas com `include_internal_chats=true` para chats do widget sem WhatsApp vinculado.
- Atribuição manual: campo `assignee_id` em `tickets`/`chat_sessions`, alterável pela UI (`components/assign-chat-menu.tsx`).

### Mudança de status
- `ticket-detail-modal.tsx` (chamado) e páginas de `internal-tickets` disparam PATCH que grava em `tickets.status`/`internal_tickets.status`.
- `lib/ticket-status.ts` centraliza o que conta como "fechado"/"em andamento" (inclui status configurados dinamicamente via `config_statuses.is_closed`, não só os hardcoded).
- Mudança de status pode disparar mensagem automática (ver `lib/services/automation-service.ts` + `automation_settings`/`automation_dispatches`).

### Comentários/respostas
- `ticket_messages`/`internal_ticket_messages`: `is_visible_to_customer` diferencia nota interna de resposta ao cliente.
- Resposta pode ser espelhada para WhatsApp: botão "Enviar por WhatsApp" no chamado chama `POST /api/whatsapp/send`, resolvendo a instância pela `queues.whatsapp_instance_id` da fila do chamado (fallback `'default'`).

### Notificações
- **Push** (Web Push/VAPID): `lib/services/push-service.ts` + `notifyUser`, disparado a partir de eventos (nova mensagem, atribuição, hotfix vencido). Assinatura via `hooks/use-push-subscription.ts` → `POST /api/push/subscribe`.
- **Polling**: `GET /api/notifications/check` — sino de notificação no header do portal.
- **Realtime de chat**: Server-Sent Events (`GET /api/chats/stream`, `GET /api/chats/internal-stream`), fan-out em memória via `EventEmitter` (`lib/chat-events.ts`) — **não é Redis/pub-sub multi-instância**; cliente tem poller de 30s como rede de segurança.

### Giro de Atendimento (rodízio diário)
- `lib/services/giro-service.ts` concentra toda a regra: geração da ordem do dia a partir da ordem do dia anterior (item mais recente com giro, não `data - 1` — fim de semana/feriado não zera o rodízio), rodízio dos livres ("último vira primeiro"), posição fixa, passagem de turno (`auto`/`pinned`/`none`), conclusão de atendimento (grava histórico + limpa linha + move para o fim, em transação) e reprocessamento.
- Data passada é **sempre** somente leitura — nunca gerada nem regerada, mesmo por quem administra. A guarda vale tanto na geração (`getGiroDay`) quanto em toda mutação (`assertRowEditable`/`assertDayWritable`/`assertHistoryEditable`), porque a tela pode ficar aberta de um dia para o outro.
- "Hora agora"/"dia de hoje" vêm sempre do Postgres com `AT TIME ZONE 'America/Sao_Paulo'` (mesma regra de `lib/report-period.ts`), nunca de `new Date()` do processo Node — o container roda em UTC.
- Botão de status: `components/giro-status-popover.tsx`, montado uma vez em `app/(portal)/layout.tsx` e mostrado só em `/dashboard` e `/tickets*` — mesmo padrão do painel de mensagens fixadas do chat interno (ref no botão+painel, fecha no Esc/clique fora, sem recarregar a tela de trás).
- Permissões: `giro:view` (uso do dia a dia — ver, registrar, concluir o próprio atendimento) e `giro:manage` (estrutura do dia — ordem, incluir/remover, passagem, reprocessar, cadastro de participantes/checklist). `manage` implica `view` nas checagens do servidor.

### Permissões por papel
- `lib/nav-items.ts` (`getNavItems`, `filterVisibleNavItems`) — mesma árvore usada por sidebar desktop e menu mobile, filtrada por `Permission[]` do usuário.
- Cliente/Funcionário: navegação reduzida (Meus Chamados, Empresa, Configurações), sem dashboard analítico.
- Administrador tem todas as `Permission` automaticamente (`getUserPermissions`); demais papéis dependem do `role_permissions` vinculado.
- Autorização fina de mutações (criar/editar usuário, editar perfil de acesso) é checada em `app/actions.ts` por função (`getAdminTeamIds`, `getActorEffectivePermissions`, `assertProfileEditable`), não só pela navegação.

---

## 8. API / rotas

Padrão predominante: rotas multiplexadas por query param `?action=...` dentro de um único `route.ts` (estilo RPC), não REST puro por recurso.

| Rota | Métodos | O que faz | Quem acessa |
|---|---|---|---|
| `/api/auth/login` | POST | Login, emite cookie JWT | Público |
| `/api/auth/logout` | POST | Limpa sessão | Público |
| `/api/auth/me` | GET | Usuário autenticado atual | Sessão válida |
| `/api/auth/change-password` | POST | Troca de senha | Sessão válida |
| `/api/tickets` | GET/POST/PATCH | `?action=messages\|recent-by-company\|by-company\|internal-links\|teams\|create\|create-message` — CRUD de chamados e mensagens | Sessão válida (autorização fina por role/permission dentro da rota) |
| `/api/search` | GET | Busca/listagem de chamados (usada pela lista principal) | Sessão válida |
| `/api/chats` | GET/POST | Sessões e mensagens de chat, histórico por empresa/cliente | Sessão válida |
| `/api/chats/stream`, `/api/chats/internal-stream` | GET (SSE) | Realtime de chat (externo e interno) | Sessão válida, dono ou "Equipe/Administrador/Time Interno" |
| `/api/chats/attachment` | GET | Serve um anexo por `messageId`+`attachmentId` (usado pelo link do PDF do histórico); resolve tanto anexo em disco quanto `data:` URL legado | Sessão válida |
| `/api/files/[...path]` | GET | Serve os anexos gravados no volume (`ATTACHMENTS_DIR`). `?download=1` força "Salvar como" | Sessão válida |
| `/api/health` | GET | Healthcheck do container (consulta o banco) | **Público** (chamado pelo Docker, sem sessão) |
| `/api/companies` | GET/POST | CRUD de empresas-cliente | Sessão válida |
| `/api/users` | GET/POST/PATCH | CRUD de usuários (parte do fluxo; grande parte também via Server Actions em `app/actions.ts`) | Sessão válida, autorização de admin/admin-de-equipe |
| `/api/users/reset-password` | POST | Reset administrativo de senha | Admin/admin de equipe |
| `/api/config` | GET/POST | Listas configuráveis (status, categorias, produtos, tipos, tags, prioridades, pesquisa de satisfação) | Sessão válida / escrita restrita por permissão |
| `/api/notifications/check` | GET | Polling do sino de notificação | Sessão válida |
| `/api/push/subscribe`, `/api/push/unsubscribe` | POST | Gerencia inscrição Web Push | Sessão válida |
| `/api/reports/audit-log` | GET | Log de auditoria | Permissão de relatório/admin |
| `/api/reports/customer-evaluations` | GET | Relatório de avaliações de cliente | Permissão de relatório |
| `/api/reports/survey` | GET | Relatório de pesquisa de satisfação | Permissão de relatório |
| `/api/whatsapp/connect` | POST | Inicia conexão Baileys (QR code) de uma instância | `whatsapp:manage` |
| `/api/whatsapp/disconnect`, `/logout` | POST | Encerra conexão/sessão Baileys | `whatsapp:manage` |
| `/api/whatsapp/status` | GET | Status da conexão (QR pendente/conectado) | `whatsapp:manage` |
| `/api/whatsapp/send` | POST | Envia mensagem de texto via WhatsApp | Sessão válida (usado pelo chat e pelo botão no chamado) |
| `/api/whatsapp/contact-photo` | GET | Busca/retorna foto de contato cacheada | Sessão válida |
| `/api/whatsapp/webhook` | POST | Recebe mensagens da Meta Cloud API | **Público** (autenticado pela Meta, sem sessão de usuário — ver `middleware.ts`) |
| `/api/integrations/keys` | GET/POST/DELETE | Gerencia chaves da API externa (`integration_api_keys`) | `settings:integrations` |
| `/api/integrations/v1/ping` | GET | Health-check autenticado por API key | Chave de API válida |
| `/api/integrations/v1/employees` | GET/POST | Funcionários de empresa-cliente, via API key | Chave com escopo `employees:read`/`employees:write` |
| `/api/integrations/v1/companies` | GET/POST | Empresas-cliente, via API key | Escopo `companies:write` (leitura provavelmente sem escopo dedicado — ⚠️ A CONFIRMAR) |
| `/api/integrations/v1/tickets` | GET | Chamados, via API key | Escopo `tickets:read` |
| `/api/integrations/v1/conversations` | GET | Conversas, via API key | Escopo `conversations:read` |
| `/api/saved-views` | GET/POST/DELETE | Buscas salvas do usuário (barra de filtros). O dono vem sempre da sessão | Sessão válida |
| `/api/giro` | GET/POST | Giro de Atendimento. `?action=summary` (botão de status), `?date=` (dia da tela); POST `action=update-row\|complete` (giro:view basta) e `action=reorder\|add-member\|remove-member\|set-handoff\|reprocess\|delete-history` (giro:manage) | `giro:view` / `giro:manage` |
| `/api/giro/config` | GET/POST | Cadastro do Giro: participantes (posição fixa, ausência) e itens do checklist | `giro:view` (leitura) / `giro:manage` (escrita) |
| `/api/giro/export` | GET | Exporta um período do Giro em CSV (uma linha por analista por dia) | `giro:view` |
| `/api/create-user` | POST | ⚠️ **Código órfão** — usa Supabase Auth real, que não está configurado neste projeto. Não usar; fluxo real de criação de usuário é a Server Action `createUser` em `app/actions.ts` | — |
| `/api/internal-tickets` | GET/POST/DELETE | `?action=by-parent\|messages` (GET), `action=save\|link\|message` (POST) e DELETE para desvincular. Criada ao tirar o `InternalTicketService` do shim | Sessão válida |

A API de integração (`/api/integrations/v1/*`) usa **autenticação por API key** (`Authorization: Bearer ssx_...` ou header `x-api-key`), independente do cookie JWT — ver `lib/integration-auth.ts`. Rate limit: 120 req/min por chave, em memória por processo (não distribuído).

---

## 9. Convenções de código

- **Nomes de arquivo**: kebab-case em `components/`, `lib/`, `hooks/` (`ticket-detail-modal.tsx`, `queue-routing.ts`). Rotas de API seguem a convenção do App Router (`route.ts` dentro da pasta do endpoint).
- **Lógica de negócio vs. UI**: regra de negócio e acesso a dados ficam em `lib/services/*.ts` (um arquivo por domínio: `ticket-service.ts`, `chat-service.ts`, `config-service.ts`, `whatsapp-service.ts`, etc.) e em Server Actions (`app/actions.ts`). Componentes em `components/` são majoritariamente client components que chamam esses services/actions ou as rotas de API.
- **Acesso a dados**: SQL puro via `query()`/`pool` de `lib/db.ts` (ou `whatsappQuery`/`whatsappPool` de `lib/whatsapp-db.ts` para o fluxo de WhatsApp). Sem query builder, sem ORM.
- **Não existe mais camada de compatibilidade Supabase.** O shim (`lib/supabase.ts`) e o tradutor `/api/compat/supabase` foram REMOVIDOS em 2026-08-12: todo acesso a dado passa por rota em `app/api/*` ou Server Action, com escopo fechado. Nenhum ponto do sistema aceita mais nome de tabela vindo do client.
- **Tipos**: única fonte em `lib/types.ts` (interfaces + enums). Não redefinir tipos de domínio localmente em componentes.
- **Tratamento de erro**: Server Actions retornam `{ error: string }` em vez de lançar (padrão usado no frontend para exibir toast). Rotas de API retornam `NextResponse.json({ error }, { status })`. Funções de log/auditoria (`lib/audit-log.ts`) nunca lançam — falha é só logada no console.
- **Validação**: feita inline nas Server Actions/rotas (checagem de permissão, campos obrigatórios), sem biblioteca de schema (zod/yup não estão no `package.json`).
- **Lint/format**: `eslint.config.mjs` (flat config) estende `next/core-web-vitals` + `next/typescript`, com `@typescript-eslint/no-explicit-any` **desligado**, `no-unused-vars` como warning, `react-hooks/exhaustive-deps` **desligado**. Rodar com `npm run lint`.
- **Encoding**: `npm run check:encoding` (`scripts/check-encoding.js`) roda automaticamente antes do build (`prebuild`) e detecta mojibake (UTF-8 lido como Latin-1) em `.ts/.tsx/.js/.jsx/.json/.md/.sql/.css`.
- **Padrão de commits**: mensagens curtas em português, imperativo, descrevendo o efeito da mudança (ex.: `Corrige reabertura silenciosa de conversa encerrada`, `Adiciona transcricao de audio sob demanda`). Sem prefixo tipo Conventional Commits (`feat:`, `fix:`). Sem emoji, sem `Co-Authored-By`.
- **Comentários no código**: o estilo do projeto é comentar o *porquê* de decisões não óbvias (armadilhas, histórico de bug, motivo de uma escolha) — não o *o quê* — inclusive em blocos multi-linha explicando trade-offs (ver `middleware.ts`, `lib/chat-events.ts`, `lib/db.ts`). Siga esse padrão ao editar esses arquivos.

---

## 10. Integrações externas

| Integração | Como | Arquivo(s) |
|---|---|---|
| WhatsApp não-oficial (QR code) | Baileys, WebSocket direto com servidores do WhatsApp | `lib/services/whatsapp-service.ts`, `lib/supabase-auth.ts` (persistência de credenciais no Postgres) |
| WhatsApp oficial (Meta Cloud API) | Webhook HTTP público, sem SDK | `app/api/whatsapp/webhook/route.ts`, `lib/services/meta-whatsapp-service.ts` |
| Web Push | VAPID (`web-push`) | `lib/services/push-service.ts`, `hooks/use-push-subscription.ts`, `public/sw.js` |
| Transcrição de áudio | Whisper local via `@huggingface/transformers` + `ffmpeg-static`, **sem API externa paga** | `lib/services/transcription-service.ts` |
| API de integração externa (parceiros/sistemas terceiros) | REST própria com API key (`Authorization: Bearer` ou `x-api-key`) | `app/api/integrations/v1/*`, `lib/integration-auth.ts`, `components/integrations-content.tsx` |
| E-mail (SMTP) | **Não implementado** — roadmap item 15/16, bloqueado por confirmação de provedor pela infra | — |
| Agente de IA (Groq) | Widget flutuante, busca por function-calling em chamados, tickets internos, chat com cliente e chat de grupo interno — combina busca por palavra-chave/SQL (sempre ativa) com busca semântica por embeddings locais sobre todo o histórico indexado (opt-in via `ENABLE_AI_EMBEDDINGS`) — Google Drive fora do escopo desta v1 | `lib/services/ai-assistant-service.ts`, `lib/services/embedding-service.ts`, `lib/services/embedding-scheduler.ts`, `app/api/ai-assistant/route.ts`, `components/ai-assistant-widget.tsx` |
| Bitrix24 (usuários) | Sincronização MANUAL (sem job automático) — **Equipe** (tela Gestão da Equipe) via `user.get`, casa por e-mail exato, cria como 'Equipe' quem não existe, salva só nome/e-mail/telefone/foto (foto baixada e guardada como `data:` URL). O sync de **Empresas** que existia aqui foi REMOVIDO em 2026-09-01 — ver linha "Planilha de CS" abaixo | `lib/services/bitrix24-service.ts`, `app/api/integrations/bitrix24/sync-users/route.ts`, `app/(portal)/team/page.tsx` |
| Planilha de CS (Google Sheets) | Sincronização MANUAL de **Empresas** (tela Empresas, botão que substituiu o "Sincronizar Bitrix24") — lê as abas "Onboarding" e "Ongoing" de uma planilha pública (URL de exportação `gviz`, sem chave/OAuth — só funciona enquanto ela continuar compartilhada como "qualquer pessoa com o link pode ver"). Importa nome (coluna B), CS Responsável (coluna C) e Comercial Responsável (coluna X) — ambos casados por nome contra `profiles` de papel de equipe (Administrador/Equipe/Time Interno); se bater com mais de uma pessoa ou nenhuma, fica em branco e é reportado no resultado (`unresolvedCs`/`unresolvedComercial`) —, Decisor e Telefone do Decisor (colunas AE/AF, texto livre, sem casamento contra `profiles`) e Id Central (coluna U no Ongoing, S no Onboarding — não é único, duas empresas podem compartilhar o mesmo id quando são marcas/CNPJs na mesma conta central). Casa empresa por nome (sem diferenciar maiúsc./minúsc.). Os 4 primeiros campos são reescritos a cada sincronização sempre que a célula da planilha não estiver vazia — inclusive por cima de uma edição manual feita no cadastro depois da sync anterior (decisão do usuário, 2026-09-02: a planilha é a fonte de verdade) | `lib/services/customer-sheet-service.ts`, `app/api/integrations/customer-sheet/sync/route.ts`, `app/(portal)/customers/page.tsx` |
| Google Agenda (lembrete de evento) | Vínculo PESSOAL por usuário via OAuth2, só leitura (`calendar.readonly`) — cada um conecta a própria conta em Configurações > Notificações. Um scheduler de fundo (`setInterval`, mesmo padrão do `hotfix-scheduler.ts`) checa a cada 2 min os eventos dos próximos ~12 min de quem está conectado e dispara push nativo (`notifyUser`) 10 min antes de cada evento com horário marcado (eventos de dia inteiro são ignorados); a mesma checagem alimenta o pop-up de tela cheia (mesmo estilo do lembrete de almoço do Giro) enquanto o portal está aberto. Não cria nem altera nada na agenda do Google | `lib/services/google-calendar-service.ts` (OAuth + chamada à API), `lib/services/google-calendar-scheduler.ts` (job de fundo), `app/api/integrations/google-calendar/route.ts` + `.../callback/route.ts`, `components/google-calendar-settings.tsx`, `components/calendar-event-reminder.tsx` |
| Supabase (BaaS real: Auth/DB/Storage) | Presente nas dependências, mas **não é o backend de dados real** hoje (ver seção 15) | `lib/supabase/server.ts` (órfão), `app/api/create-user/route.ts` (órfão) |
| Fonte tipográfica (Rooney Sans) | Carregada via Adobe Typekit (`use.typekit.net`) | `app/layout.tsx` |

---

## 11. Deploy

- **Roda em container Docker, num processo próprio e contínuo.** O projeto já esteve na Vercel; a migração para Docker foi concluída e **a Vercel não é mais usada** (2026-08-12). Não assuma serverless em lugar nenhum: não há limite de duração de função, o processo não é reciclado entre requisições e `setInterval`/WebSocket sobrevivem — é o que faz o Baileys e os schedulers funcionarem de verdade.
- `next.config.ts`:
  - `eslint.ignoreDuringBuilds: true` e `typescript.ignoreBuildErrors: true` — **build não falha por erro de lint/tipo**. Ver seção 14 (dívida técnica).
  - `serverExternalPackages` inclui `@whiskeysockets/baileys`, `pg`, `@huggingface/transformers`, `onnxruntime-node`, `sharp`, `ffmpeg-static`, etc. — pacotes nativos que não devem ser bundlados pelo Next.
  - `outputFileTracingExcludes` remove binários `onnxruntime-node` de `win32`/`darwin` da imagem (o container roda Linux; os outros ~160MB são peso morto).
- **Migrations em produção**: existe runner com controle de estado — `scripts/run-migrations.js`, tabela `public.schema_migrations`. `--baseline` marca tudo o que já existe como aplicado sem executar (usado uma única vez, na adoção); sem argumento, aplica só o pendente, um arquivo por transação; `--status` só lista. Nunca toca em `schema_postgres.sql` (que dropa tabelas).
  - **Estado em 2026-08-12: a tabela existe mas está VAZIA** — o `--baseline` ainda **não** foi rodado (decisão do usuário: deixar como está, já que nada na aplicação lê essa tabela). Consequência prática: as 66 migrations do histórico aparecem como "pendentes" mesmo já estando aplicadas no banco à mão. O runner tem trava pra isso — com registro vazio e arquivos pendentes ele **recusa** executar e explica as saídas (`--baseline` pra banco existente, `--force` pra banco novo do zero). Não contorne a trava com `--force` contra o banco de produção: reaplicar o histórico quebra no meio (nem toda migration é idempotente).
- **Docker** (`Dockerfile` + `docker-compose.yml`): build multi-stage sobre `node:22-bookworm-slim` (**não** Alpine — `onnxruntime-node`/`sharp`/`ffmpeg-static` são nativos contra glibc e falham em musl só em runtime), `output: 'standalone'` no `next.config.ts`, healthcheck em `GET /api/health` (rota pública em `middleware.ts`). O Postgres **não** está no compose: é o banco próprio da equipe, apontado por `DATABASE_URL`. Volumes: `attachments` (`/data/attachments`) e `models` (`/data/models`, só cache).
  - ✅ **Imagem construída e testada em 2026-08-12** (`ssx-desk:latest`, 1.08GB, ~3min de build). Validado de ponta a ponta contra um Postgres descartável: container sobe `healthy` em ~18s, login/dashboard/tickets/chat-management/settings respondem 200, anexo é gravado no volume como `node:node` (particionado `ano/mês`) e servido por `/api/files`, path traversal barrado, e `scripts/run-migrations.js` roda via `docker compose run`. O `postinstall` do `ffmpeg-static` baixa binário da internet — **o build exige rede**.
  - ⚠️ **Falha de gravação de anexo é SILENCIOSA** (testado, não é teoria). Com o volume sem permissão de escrita pro usuário `node` (caso real: bind-mount de diretório do host, ou volume preexistente com dono `root`), o container continua `healthy`, a API devolve 200 e o usuário não vê erro nenhum — mas `persistAttachments` cai no fallback e o arquivo volta pro banco como `data:` URL em base64. A única pista é uma linha `[attachment-storage] Falha ao gravar anexo em disco` no log do container. Volume novo não tem o problema (o Docker inicializa com o dono da imagem, que é `node`).
  - **Uma réplica só, obrigatoriamente**: `lib/chat-events.ts` faz fan-out do SSE por `EventEmitter` em memória do processo e `instrumentation-node.ts` sobe 5 schedulers (automação, hotfix, embeddings, insatisfação, lembrete de Google Agenda) em todo processo que inicia — dois containers duplicariam mensagem automática (e push de lembrete) enviados ao cliente/usuário. Escalar exige antes trocar o fan-out por `pg LISTEN/NOTIFY` e eleger um dono dos schedulers.
  - **Migração de anexos — PENDENTE**: `scripts/migrate-attachments-to-disk.js` move os anexos legados (`data:` URL no banco) para o volume. Roda dentro do container (precisa enxergar o volume), é idempotente e tem `--dry-run`. Dump do banco antes — ele reescreve `chat_messages`, `internal_chat_messages`, `ticket_messages`, `internal_ticket_messages` e `tickets`. Só o `--dry-run` foi executado (em 2026-08-12, contra o banco real: 18 anexos, 6,2 MB); a migração de verdade **ainda não rodou**, e depende do Docker funcionar. Enquanto isso, o banco segue com anexos antigos em `data:` URL — por isso todo leitor de anexo precisa aguentar as duas formas (ver seção 15).
  - Atrás de reverse proxy, o SSE (`/api/chats/stream`) exige `proxy_buffering off` e timeout longo — com buffer, o realtime do chat degrada silenciosamente para o polling de 30s.
- **Variáveis `NEXT_PUBLIC_*` são embutidas no bundle em tempo de build**, não lidas em runtime. Como o `.env` não entra na imagem (`.dockerignore`), elas chegam por `build.args` no `docker-compose.yml` → `ARG`/`ENV` no `Dockerfile`. Hoje são três: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_ENABLE_AUDIO_TRANSCRIPTION` e `NEXT_PUBLIC_APP_URL`. **Ao adicionar uma nova, é obrigatório acrescentá-la nos dois arquivos** — senão ela vira `undefined` no código compilado e o `env_file` não recupera. O sintoma típico é mudo: o Web Push simplesmente para de assinar, sem erro no log.
- **Mudar qualquer `NEXT_PUBLIC_*` exige rebuild** (`docker compose up -d --build`), não basta reiniciar o container.
- **Acesso externo**: existe um serviço `cloudflared` no `docker-compose.yml` sob o profile `tunnel` (`docker compose --profile tunnel up -d`), que publica o portal em HTTPS sem abrir porta. HTTPS não é opcional: o cookie de sessão é gravado com `secure` quando `NODE_ENV=production`, então em HTTP puro o navegador descarta o cookie e **o login falha em silêncio** (`localhost` é a exceção da regra no navegador).
- **Server Actions atrás de proxy**: o Next 15 recusa Server Action quando o `Origin` não bate com o `Host`, e não há `serverActions.allowedOrigins` no `next.config.ts`. O proxy precisa repassar `X-Forwarded-Host`/`X-Forwarded-Proto` corretos — senão as páginas abrem normalmente e só as mutações de `app/actions.ts` falham.

---

## 12. Estado atual (~70%)

### ✅ Pronto e funcionando
- Autenticação por JWT + cookie httpOnly, com gate global em `middleware.ts`.
- CRUD completo de chamados (tickets), com fila, categoria, tipo de solicitação, produto e tags separados (migration aplicada).
- Sistema de permissões por "Perfil de Acesso" (RBAC próprio, não baseado só em `role`), com escopo por equipe interna.
- Chat ao vivo via WhatsApp (Baileys + Meta Cloud API) e via widget para clientes logados, com distribuição automática por fila (round-robin e "equilíbrio diário").
- Realtime de chat via SSE + polling de segurança.
- Histórico de conversas (com download TXT/PDF/ZIP), histórico "sob demanda" por contato/empresa.
- Duplicar / vincular / mesclar chamados e conversas.
- Tickets internos (dev/infra/QA/produto) com vínculo N:N a chamados, SLA por prioridade, e cadastro de Hotfix com alerta automático por push.
- Avaliação interna de empresas-cliente (não visível ao cliente) + relatório.
- Notificações push (Web Push/VAPID) e painel de notificação in-app.
- Transcrição de áudio local (Whisper), sob demanda ou automática, com fallback gracioso.
- Auditoria de ações (`audit_log`) e histórico de alterações de chamado/ticket interno.
- API de integração externa com autenticação por API key, escopos e rate limit.
- PWA (manifest + service worker) e layout mobile dedicado.

### 🚧 Parcial / incompleto
| Item | O que falta | Onde está o trabalho pela metade |
|---|---|---|
| Botão "Enviar resposta pelo WhatsApp" no chamado | Implementado, mas nunca testado ponta-a-ponta (sem instância WhatsApp conectada no ambiente de desenvolvimento no momento da implementação) | `components/ticket-detail-modal.tsx`, `app/api/whatsapp/send/route.ts` |
| Endpoint `GET /api/tickets?action=teams` | Faz `SELECT member_ids FROM internal_teams`, coluna que **não existe** em nenhum schema — endpoint quebrado | `app/api/tickets/route.ts`, consumido por `app/(portal)/tickets/page.tsx` (seletor "atribuir por equipe") |
| Mensagens automáticas por instância errada | `lib/services/automation-service.ts:197` usa `WhatsAppService.sendMessage('default', ...)` fixo, em vez de resolver pela Fila do chamado (como o botão manual e o chat fazem) — pode enviar pela instância errada se houver mais de uma configurada | `lib/services/automation-service.ts` |
| Configuração de e-mail (SMTP) | Tela não iniciada — bloqueada por confirmação de provedor pela infra (roadmap item 15) | Não iniciado |
| Disparo de e-mail (resposta ao cliente + notificação de atribuição) | Não iniciado — depende do item acima | Não iniciado |
| `app/api/create-user/route.ts` | Usa Supabase Auth real (`@supabase/supabase-js`) com variáveis de ambiente que **não existem** no `.env` atual — código órfão, não deveria estar no fluxo | Endpoint inteiro; fluxo real é a Server Action `createUser` em `app/actions.ts` |
| `lib/supabase/server.ts` | Cliente Supabase SSR real, sem nenhuma variável de ambiente configurada — não é chamado por nenhum fluxo ativo identificado | Arquivo inteiro — ⚠️ A CONFIRMAR se há algum consumidor não encontrado na varredura |
| `app/(portal)/activities/page.tsx` | Propósito não inspecionado a fundo nesta varredura | ⚠️ A CONFIRMAR |

---

## 13. Roadmap / backlog

Backlog vivo e priorizado está em [`manuais/roadmap/ROADMAP_MELHORIAS.md`](manuais/roadmap/ROADMAP_MELHORIAS.md) (1ª rodada, concluída, atualizado em 2026-07-24) e na sequência em [`manuais/roadmap/ROADMAP_MELHORIAS_2.md`](manuais/roadmap/ROADMAP_MELHORIAS_2.md) (2ª rodada — Bitrix24 + IA, atualizado em 2026-08-05) — ambos movidos da raiz para `manuais/roadmap/` — **consultar esses arquivos antes de assumir prioridade**, o resumo abaixo é um retrato do que restava na 1ª rodada:

| Prioridade | Item | Complexidade | Arquivos prováveis |
|---|---|---|---|
| P3 | Tela de configuração de e-mail (SMTP) | Média | Novo componente em `app/(portal)/settings/`, nova tabela de config |
| P3 | Disparo de e-mail (resposta ao cliente + notificação de atribuição) | Alta (depende de infra externa confirmada) | Novo `lib/services/email-service.ts`, `app/actions.ts`, `lib/services/automation-service.ts` |

Itens de prioridade P0–P4 anteriores (separação Fila/Categoria/Tipo, campo de Produto, lightbox único, botão WhatsApp no chamado, histórico sob demanda, duplicar/vincular/mesclar chamado, tela por empresa, estratégias de fila configuráveis, cadastro de Hotfix) estão **concluídos** — ver seção 12 e o próprio `ROADMAP_MELHORIAS.md` para o detalhamento e decisões tomadas em cada um.

O documento também descreve um **pipeline de trabalho obrigatório por item** (seleção → discovery técnico → alinhamento → plano formal → implementação incremental → ajuste fino) — seguir esse fluxo ao pegar qualquer item do roadmap, não implementar direto.

---

## 14. Bugs conhecidos e dívida técnica

Extraído de `ROADMAP_MELHORIAS.md` (seção "Erros/inconsistências encontrados pelo caminho") + achados desta varredura:

1. **`app/api/tickets/route.ts` (`?action=teams`)** — consulta `internal_teams.member_ids`, coluna inexistente em qualquer schema. Endpoint quebrado hoje, usado pelo seletor "atribuir por equipe" em `app/(portal)/tickets/page.tsx`.
2. **`lib/services/automation-service.ts:197`** — mensagens automáticas disparam sempre pela instância `'default'` do WhatsApp, ignorando a Fila do chamado. Pode sair pela instância errada com múltiplas instâncias configuradas.
3. **Build sem rede de segurança de tipo/lint**: `next.config.ts` tem `typescript.ignoreBuildErrors: true` e `eslint.ignoreDuringBuilds: true` — erros de TypeScript e lint **não bloqueiam o build/deploy**. Rodar `npx tsc --noEmit` e `npm run lint` manualmente antes de considerar uma mudança pronta (não é automático).
4. **Código órfão ligado a Supabase real**: `app/api/create-user/route.ts` e `lib/supabase/server.ts` dependem de `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, ausentes do `.env` atual. Não usar como referência de fluxo real de criação de usuário.
5. ~~`supabase_schema.sql` desatualizado~~ — **resolvido em 2026-08-13**: o arquivo foi removido e `schema_postgres.sql` foi alinhado com produção.
6. **Realtime de chat não é multi-instância**: `lib/chat-events.ts` usa `EventEmitter` em memória por processo — com mais de uma réplica, cada uma só notifica quem está conectado nela mesma. Hoje isso não morde porque roda um container só (ver seção 11), e é uma das razões de ser um só. Mitigado por polling de 30s no cliente e por `chat_session_viewers` (persistido) para o cálculo de push. Se escalar de fato, o próprio código já aponta a solução: `pg LISTEN/NOTIFY`.
7. **Rate limit da API de integração é em memória, por processo** (`lib/integration-auth.ts`) — não é distribuído; múltiplas instâncias relaxam o limite real.
8. **`README.md` é o template genérico original** ("AI Studio"/Gemini), não descreve o projeto atual — não usar como documentação, foi substituído por este arquivo.
9. **Migrations não têm tracking automático** — nenhuma tabela de "migrations aplicadas"; depende de disciplina manual (ver seção 11).
10. ~~Debug logging na rota compat~~ — a rota deixou de existir (shim removido em 2026-08-12). Fica a lição: log de requisição gravado como ARQUIVO dentro de `app/` faz o Next recompilar e corta requisições no meio ("Unexpected end of JSON input" aleatório). Nunca escreva log em arquivo dentro da pasta observada.

---

## 15. Decisões e armadilhas

- **Por que SQL puro e não um ORM**: o projeto migrou de um protótipo Supabase (BaaS) para Postgres próprio via `pg`. Durante essa migração existiu um **shim de compatibilidade** (`lib/supabase.ts` + `/api/compat/supabase`) que aceitava chamadas no estilo `supabase.from('table').select()` e as traduzia em SQL — assim o frontend não precisou ser reescrito de uma vez. **Ele foi removido em 2026-08-12**, junto com os 16 arquivos que dependiam dele. O motivo de não ter sobrevivido: ele recebia o NOME DA TABELA como dado, então qualquer usuário autenticado podia ler ou escrever em qualquer tabela — inclusive `profiles` e `integration_api_keys`. Além disso ignorava a lista de colunas do `.select()`, o que fazia toda consulta trazer a linha inteira (a origem dos ~50MB de avatares em base64 em telas que só queriam um nome). Hoje cada operação tem rota própria com escopo fechado.
- **`lib/supabase-auth.ts` não usa Supabase**: o nome foi mantido por compatibilidade com os consumidores (Baileys), mas a função `useSupabaseAuthState` hoje persiste credenciais no Postgres próprio (`whatsapp_sessions`), não no Supabase Auth. Não deixe o nome do arquivo enganar.
- **`tickets.category` continua existindo mesmo sendo legado**: mantido só para não quebrar a API pública de integrações externas que já dependia dela. Código novo não deve escrever nesse campo — usar `category_id`/`request_type_id`/`product_id`.
- **`chat_sessions.ticket_id`/`ticket_number` não significam "único chamado desta conversa"**: desde a introdução de `tickets.chat_session_id` (N:1 invertido), esses campos passaram a significar "chamado mais recente desta conversa" — o mesmo badge visual de sempre, mas semântica diferente por baixo.
- **Mesclar chamado não reaproveita o status "Fechado"**: existe um status dedicado `"Mesclado"` (em `CLOSED_TICKET_STATUSES`) porque fechar de verdade dispararia notificação indevida ao cliente via automação. Se for mexer em `mergeTickets`/`duplicateTicket`, lembre que eles gravam SQL direto de propósito, para **não** disparar automação/notificação.
- **Anexo mora em disco, não no banco** (`lib/services/attachment-storage.ts`): o arquivo é gravado em `ATTACHMENTS_DIR/<ano>/<mês>/<uuid>.<ext>` e o que fica em `attachments_data`/`metadata.attachments` é só `{ url: '/api/files/...' }` + nome/tipo/tamanho. A conversão do `data:` URL que o client envia acontece **no servidor**, em todo ponto de escrita (`/api/chats` push-message e save-internal-message, `/api/tickets` create/create-message, `/api/internal-tickets` message e a mídia recebida do WhatsApp) — o front continua mandando `data:` URL, de propósito, pra não precisar de fluxo de upload separado. Ao criar um ponto de escrita novo com anexo, chame `persistAttachments`, senão ele volta a inflar o banco em base64. Quem **lê** anexo precisa aguentar as duas formas: registros antigos ainda são `data:` URL até `scripts/migrate-attachments-to-disk.js` passar por eles. Não existe tabela de índice de arquivos — o caminho está na própria URL, e `resolveAttachmentPath` é quem barra path traversal.
- **`chat_histories.rating` NÃO é o dígito que o cliente digita**: na pesquisa de satisfação o cliente responde `"1"` (bom) / `"0"` (ruim), mas a coluna usa a escala **-1 (negativo) / 0 (neutro) / 1 (positivo)** — lida assim por histórico de conversas, relatórios de satisfação e dashboard gerencial. Gravar o dígito cru faz a avaliação ruim virar "neutro" e desaparecer de todas as contagens (era exatamente o bug corrigido em `migrations/fix_survey_negative_rating.sql`; as avaliações boas nunca falharam porque `1` coincide nas duas escalas, o que mascarou o problema). A conversão fica em quem recebe a resposta: `lib/services/whatsapp-service.ts` (canal Baileys) e `components/chat-widget.tsx` (widget), com normalização defensiva também em `app/api/chats/route.ts` (`action=submit-survey-response`). Ao ler `rating`, nunca usar teste de veracidade (`!!rating` / `rating || null`) — `0` e `-1` quebram os dois; comparar explicitamente com `1`/`-1`/`IS NOT NULL`.
- **`internal_team_ids` vs. `internal_teams.admin_ids`**: um usuário pode *pertencer* a várias equipes internas (`profiles.internal_team_ids`) sem *administrar* nenhuma. Só quem está em `admin_ids` de uma equipe pode criar/editar usuários e perfis de acesso escopados a ela — checado em `app/actions.ts` (`getAdminTeamIds`), não na navegação.
- **`role` em `profiles` é estrutural, não de permissão**: dois usuários com `role = 'Equipe'` podem ter permissões completamente diferentes via `access_profile_id`. Nunca decidir acesso a uma tela olhando só `role` — sempre via `Permission`.
- **Baileys exige processo contínuo — e é exatamente por isso que o deploy é container, não serverless**: a conexão WebSocket é reaberta no boot por `instrumentation-node.ts` e vive dentro do mesmo processo que atende as requisições. Isso amarra duas coisas: (1) reiniciar o container derruba e reconecta o WhatsApp; (2) duas réplicas brigam pela mesma sessão. Não "melhorar" isso com polling agressivo dentro da rota Next.
- **`next.config.ts` ignora erros de tipo/lint no build de propósito** (aparentemente para não travar deploys durante desenvolvimento ativo) — isso significa que **passar no build não é garantia de tipo correto**. Rode `tsc --noEmit` manualmente.

---

## 16. Regras para o agente de IA neste projeto

Baseado em `AGENTS.md` (já existente no repositório) + observações desta varredura:

**Sempre:**
- Ler `schema_postgres.sql` antes de qualquer mudança de banco — é a fonte de verdade. **Ao aplicar uma migration em produção, refletir a mudança nele também**: foi o que deixou de ser feito e gerou o drift de 9 tabelas/16 colunas corrigido em 2026-08-13.
- Preservar componentes existentes em `components/` e `app/(portal)/` ao alterar layout — não são para ser recriados do zero.
- Garantir que qualquer nova variável de ambiente fique documentada (não existe `.env.example` hoje — se criar uma mudança que introduza uma env var, adicione-a também na seção 4 deste arquivo).
- Rodar `npx tsc --noEmit -p tsconfig.json` e `npm run lint` antes de considerar uma tarefa concluída — o build **não** falha sozinho com erro de tipo/lint (seção 14, item 3).
- Seguir o pipeline de 6 etapas do `ROADMAP_MELHORIAS.md` (discovery → alinhamento → plano → implementação incremental → ajuste fino) ao pegar um item do roadmap — não implementar direto sem levantar o estado atual do código primeiro, pois o roadmap avisa que pode estar desatualizado em relação ao código.
- Perguntar antes de decidir algo marcado `[Decisão pendente]` no roadmap, em vez de assumir.
- Confirmar o mecanismo real de storage de anexos antes de assumir persistência — não foi localizado nesta varredura o destino físico do upload (⚠️ ver seção 17/resumo abaixo).

**Nunca:**
- Rodar `schema_postgres.sql` (que começa com `DROP TABLE ... CASCADE`) contra um banco com dados reais.
- Fazer refactors globais que alterem estrutura de pastas ou removam arquivos sem pedido explícito do usuário (regra crítica já existente em `AGENTS.md`).
- Commitar `.env` (já coberto por `.gitignore`, mas confirme antes de qualquer `git add -A`).
- Alterar migrations já aplicadas em produção (arquivos em `migrations/`) — criar uma nova migration em vez de editar uma existente.
- Assumir que `README.md` descreve o projeto — é o template genérico original, ignore-o como fonte de verdade.
- Recriar qualquer forma de endpoint genérico que receba nome de tabela/coluna do client (era o que o shim removido fazia) — cada operação deve ter rota própria, com escopo fechado.
- Usar `app/api/create-user/route.ts` ou `lib/supabase/server.ts` como referência de fluxo — são código órfão (seção 14, item 4).

---

## 17. Trabalho em paralelo

⚠️ **A CONFIRMAR** — não foi possível determinar uma convenção formal de branches/PR a partir do histórico do Git: os commits recentes (`git log`) mostram todos indo direto contra um único histórico linear, sem merge commits de PR nem branches nomeadas visíveis no log (`Correções de segurança`, `Correção Sub-status`, `Mudanças Visuais`, ...). Isso sugere que, até o momento desta varredura, o desenvolvimento tem sido feito por uma única pessoa direto na branch principal, sem fluxo de PR estabelecido.

Recomendações objetivas para dois devs trabalharem ao mesmo tempo, dado o que existe hoje:

- **Schema/migrations é o ponto de maior risco de conflito**: como não há ORM nem tracking automático (seção 11/14), dois devs alterando `schema_postgres.sql` ou criando migrations em paralelo podem gerar SQL incompatível sem o Git avisar (é tudo texto solto). Antes de começar uma mudança de schema, avisar o outro dev e verificar se `schema_postgres.sql` já tem uma migration pendente não aplicada.
- **Áreas com "dono" natural por causa do desenho do código**: `lib/services/whatsapp-service.ts` e `lib/services/meta-whatsapp-service.ts` (WhatsApp) são bem isolados de `lib/services/ticket-service.ts`/`chat-service.ts` (chamados/chat) — bom ponto de divisão de trabalho para reduzir conflito de merge.
- **`lib/types.ts` e `lib/nav-items.ts` são compartilhados por quase tudo** — mudanças ali tendem a gerar conflito; coordenar antes de editar essas duas arestas.
- Como não há CI/PR configurado visivelmente neste repositório, qualquer processo de PR/branch deve ser combinado diretamente com o usuário antes de ser adotado — **não assumir GitHub Flow, trunk-based ou qualquer convenção sem confirmar**.

---

## Resumo do que ficou marcado ⚠️ A CONFIRMAR

1. Se `.env.example` deveria existir no repositório (hoje não existe, apesar do `.gitignore` já prever um `!.env.example`).
2. Se o `DATABASE_URL` atual do `.env` aponta para produção/staging ou ambiente pessoal — crítico antes de rodar `schema_postgres.sql` (que dropa tabelas).
3. ~~Existência da coluna `companies.is_in_training`~~ — **resolvida**: existe no banco de produção (verificada em 2026-08-12), mas está entre as ~16 colunas ausentes do `schema_postgres.sql`.
4. Propósito exato de `app/(portal)/activities/page.tsx`.
5. ~~Rota `app/api/debug-internal-tickets`~~ — **resolvida**: era debug da geração de número de ticket interno, nenhum consumidor. Removida em 2026-08-12.
6. Se há algum consumidor de `lib/supabase/server.ts` fora do que foi encontrado nesta varredura.
7. Escopo de leitura de `/api/integrations/v1/companies` (a rota de escrita usa `companies:write`; não ficou claro se leitura exige escopo próprio).
8. ~~Onde os anexos são fisicamente armazenados~~ — **resolvido**: vão para o volume `attachments` (`ATTACHMENTS_DIR`), servidos por `/api/files/...`. Ignore a instrução do `AGENTS.md` de usar Supabase Storage: não é o que existe. Ver seção 15.
9. Branches/estratégia de PR para trabalho em paralelo — não há convenção visível no histórico do Git.
10. ~~Branches/ambientes configurados na Vercel~~ — **resolvido**: a Vercel saiu do projeto (2026-08-12), o deploy é o container do `docker-compose.yml`.
