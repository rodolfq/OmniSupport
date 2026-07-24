# Roadmap de Melhorias — OmniSupport / SSX Resolve

> Documento interno de planejamento. Não é um plano de implementação fechado — é a base para irmos item a item: cada linha vira uma rodada de discovery + plano + implementação + ajuste fino antes de passar para a próxima.
>
> Última atualização: 2026-07-24.

## Como usar este documento

- **Status** de cada item: `🔲 Não iniciado` / `🔵 Em implementação` / `🟡 Implementado, aguardando teste` / `⚠️ Erro conhecido / revisar` / `✅ Concluído`.
- **Prioridade** é uma sugestão de ordem, não um compromisso de data. Pode ser reordenada a qualquer momento.
- Itens marcados **[Decisão pendente]** têm uma pergunta em aberto que precisa ser resolvida antes ou durante o discovery daquele item específico.

---

## Pipeline de trabalho (caso a caso)

Para cada item deste roadmap, seguimos as mesmas 6 etapas — sem pular nenhuma, mesmo em itens pequenos:

1. **Seleção** — você aponta qual item da lista é a vez (não precisa seguir a ordem numérica à risca).
2. **Discovery técnico** — releio o código hoje afetado por aquele item específico (pode já ter mudado desde este documento) e escrevo um mini-desenho técnico: quais tabelas/campos mudam, quais telas/componentes são tocados, o que é novo vs. o que é reaproveitado.
3. **Alinhamento** — se sobrar alguma decisão de produto (nome de campo, comportamento em caso de borda, etc.), pergunto antes de escrever código. Não assumo.
4. **Plano formal** — para itens de médio/grande porte, apresento um plano (passo a passo, arquivos afetados) para sua aprovação antes de mexer em código.
5. **Implementação incremental** — mudanças pequenas e testáveis, não um commit gigante. Aviso quando algo tocar em dado existente (migração, campo reaproveitado, etc.), que é mais sensível.
6. **Ajuste fino** — você testa na tela, dá feedback, iteramos até fechar. Só then marco como `✅ Concluído` e atualizo este arquivo.

Regra combinada: nada é implementado sem passar por este fluxo — este documento é só o mapa, não uma fila de execução automática.

---

## Prioridades (ordem sugerida)

| # | Prioridade | Item | Motivo da ordem |
|---|---|---|---|
| 1 | P0 | [Separar Fila / Categoria / Tipo de Solicitação](#1-separar-fila--categoria--tipo-de-solicitação-p0) | Mudança de modelo de dados que outros itens (produtos) dependem — melhor resolver primeiro |
| 2 | P0 | [Campo de Produtos no chamado](#2-campo-de-produtos-no-chamado-p0) | Mesma família de mudança do item 1, mesma migração vale a pena fazer junto |
| 3 | P0 | [Refatorar tela de Configurações](#3-refatorar-tela-de-configurações-p0) | Escopo revisado: usuário decidiu não unificar — sem trabalho pendente |
| 4 | P1 | [Lightbox de imagem único (chat, chamado, etc.)](#4-lightbox-de-imagem-único-p1) | Ganho rápido: o componente já existe, é só eliminar a duplicação |
| 5 | P1 | [Botão "Enviar resposta pelo WhatsApp" no chamado](#5-botão-enviar-resposta-pelo-whatsapp-no-chamado-p1) | Ganho rápido: a API de envio já existe, falta só o botão/fluxo na tela de chamado |
| 6 | P1 | [Documentar e deixar explícita a ordem da fila](#6-documentar-e-deixar-explícita-a-ordem-da-fila-p1) | A lógica já existe no código; falta só deixar visível/claro nas configurações — baixo esforço |
| 7 | P2 | [Histórico da conversa sob demanda (+2 em +2)](#7-histórico-da-conversa-sob-demanda-p2) | Ganho grande de produtividade no atendimento, esforço médio |
| 8 | P2 | ["Histórico de chamados recentes" ao lado de "Histórico Cliente"](#8-histórico-de-chamados-recentes-p2) | Mesma área de tela do item 7, faz sentido junto |
| 9 | P2 | [Duplicar o chat (novo atendimento a partir do atual)](#9-duplicar-o-chat-p2) | Depende de entender bem o fluxo de chat/ticket_id; médio esforço |
| 10 | P2 | [Permitir múltiplos chamados na mesma conversa](#10-permitir-múltiplos-chamados-na-mesma-conversa-p2) | Relacionado ao item 9, mas é uma mudança de regra (hoje é 1:1 forçado) |
| 11 | P2 | [Vincular chat a um chamado já existente](#11-vincular-chat-a-um-chamado-já-existente-p2) | Mesma área dos itens 9/10 |
| 12 | P2 | [Mesclar e duplicar chamado](#12-mesclar-e-duplicar-chamado-p2) | Mesma área; convém fazer depois dos itens 9-11 para não redesenhar duas vezes o "chat com mais de um chamado" |
| 13 | P2 | [Tela dedicada por empresa (clique no campo "Empresa")](#13-tela-dedicada-por-empresa-p2) | Reaproveita o que for construído nos itens de histórico (7, 8) |
| 14 | P3 | [Novas estratégias de fila configuráveis](#14-novas-estratégias-de-fila-configuráveis-p3) | Precisa de brainstorm de opções antes; a base (item 6) precisa estar pronta |
| 15 | P3 | [Tela de configuração de e-mail (SMTP)](#15-tela-de-configuração-de-e-mail-smtp-p3) | Infraestrutura ainda não confirmada pelo time interno — dá para deixar a tela pronta enquanto isso é confirmado |
| 16 | P3 | [Disparo de e-mail (resposta ao cliente + notificação de atribuição)](#16-disparo-de-e-mail-p3) | Depende do item 15 e da confirmação de credenciais pela infra |
| 17 | P4 | [Cadastro de Hotfix / janela de release](#17-cadastro-de-hotfix--janela-de-release-p4) | Módulo isolado, não bloqueia nem é bloqueado por nada acima — pode entrar em qualquer momento conforme a urgência do time |

---

## Status geral (resumo)

*Atualizado em 2026-07-24.*

### ✅ Concluídos (código pronto, testado ou sem teste pendente)

| # | Item | Observação |
|---|---|---|
| 1 | Separar Fila / Categoria / Tipo de Solicitação | Migration aplicada em produção, testado |
| 2 | Campo de Produtos no chamado | Migration aplicada em produção, testado |
| 3 | Refatorar tela de Configurações | Escopo revisado — usuário decidiu não unificar, nada a implementar |
| 4 | Lightbox de imagem único | Deduplicado, testado via build |
| 6 | Documentar e deixar explícita a ordem da fila | Card explicativo adicionado na tela de Filas |
| 7 | Histórico da conversa sob demanda (+2 em +2) | Migration do índice aplicada e aprovada |
| 8 | "Histórico de chamados recentes" | Filtrado por empresa, sem migration pendente |
| 9 | Duplicar o chat | Sem mudança de schema, sem migration pendente |
| 10 | Permitir múltiplos chamados na mesma conversa | Migration aplicada e confirmada em produção |
| 11 | Vincular chat a um chamado já existente | Sem migration pendente; corrigido bug de z-index no ConfirmDialog |
| 12 | Mesclar e duplicar chamado | Migration aplicada e confirmada em produção |
| 13 | Tela dedicada por empresa | Sem migration; rota nova `/customers/[id]` |
| 14 | Novas estratégias de fila configuráveis | Migration aplicada e confirmada em produção |
| 17 | Cadastro de Hotfix / janela de release | Migration aplicada e confirmada em produção — implementado fora de ordem, a pedido |

### 🟡 Implementado, falta testar

| # | Item | O que falta testar |
|---|---|---|
| 5 | Botão "Enviar resposta pelo WhatsApp" no chamado | Não há WhatsApp conectado no ambiente ainda. Testar quando houver instância ativa: enviar resposta pelo botão, conferir entrega no WhatsApp do contato e registro no chamado |

### 🔲 Falta implementar

| # | Item | Prioridade |
|---|---|---|
| 15 | Tela de configuração de e-mail (SMTP) | P3 |
| 16 | Disparo de e-mail | P3 |

### ⚠️ Erros/inconsistências encontrados pelo caminho (não são dos itens em si — pré-existentes, sinalizados mas não corrigidos, ver depois)

| Onde | Problema | Contexto |
|---|---|---|
| `app/api/tickets/route.ts` (`GET ?action=teams`) | Faz `SELECT member_ids FROM internal_teams`, coluna que não existe em nenhum schema — endpoint quebrado hoje | Encontrado durante o discovery do item 1; usado por `app/(portal)/tickets/page.tsx` no seletor de "atribuir por equipe". Não corrigido por estar fora do escopo do item 1 |
| `lib/services/automation-service.ts:197` | Disparo automático de mensagens do sistema usa `WhatsAppService.sendMessage('default', ...)` com instância fixa, em vez de resolver pela Fila do chamado (como o botão manual do item 5 e o chat fazem) | Encontrado durante o discovery do item 5. Mensagens automáticas podem sair pela instância errada se houver mais de uma configurada. Não corrigido — mudança de comportamento de automação existente, fora do escopo pontual do item 5 |
| Debug logging removido (`app/api/compat/supabase/route.ts`) | ~~Gravava log de toda requisição em arquivo dentro da pasta observada pelo Next.js, causando recompilações (Fast Refresh) que cortavam requisições no meio, gerando erros aleatórios em toda a aplicação~~ | **Corrigido** em 2026-07-24 (removida a instrumentação). Mantido aqui só como registro — se erros parecidos com "Unexpected end of JSON input" voltarem a aparecer, é o primeiro lugar a checar |

---

## Detalhamento por item

### 1. Separar Fila / Categoria / Tipo de Solicitação (P0)
**Status:** ✅ Concluído — migration aplicada em produção, tabelas/colunas confirmadas (`config_request_types`, `tickets.queue_id/category_id/request_type_id/tags`).

**Situação atual:** o banco tem uma única coluna `tickets.category`. Na tela do chamado essa coluna era exibida e tratada como "Equipe" (`ticket-detail-modal.tsx`). Na tela de Configurações, o mesmo dado aparece como **"Categoria"** (`system-config-content.tsx`). Ou seja, "Categoria" e o antigo "Equipe" eram a mesma coisa disfarçada de duas telas diferentes — e não existia nenhum campo "Tipo de Solicitação".

**Decisão tomada (revisada):** separar em **3 conceitos independentes**: **Fila**, Categoria e Tipo de Solicitação, cada um com sua própria lista configurável.
- **Fila** substitui o antigo conceito de "Equipe" e reaproveita a tabela `queues` que já existe (com CRUD próprio em `/queues`) — **não** a tabela `internal_teams`. É um campo só de seleção manual/exibição no chamado: **não dispara nenhuma distribuição automática** (a lógica de fila em `lib/services/queue-routing.ts` continua baseada só em status online, sem relação com este campo).
- Sem backfill: chamados antigos ficam com Fila/Categoria/Tipo de Solicitação em branco, preenchidos só dali pra frente (o texto livre antigo de `category` não mapeia com segurança para nenhuma das listas novas).
- **Não é replicado em `internal_tickets`** — o time interno terá seus próprios marcadores/tags, à parte.
- `category` continua existindo na tabela (coluna legada, sem uso pelo código novo), só para não quebrar a API pública de integrações externas.
- Nova tabela `config_request_types` (mesmo padrão de `config_categories`).
- Corrigido de brinde: bug de `tags` no chamado que nunca persistia (coluna não existia; dois caminhos de código já tentavam gravar nela).

---

### 2. Campo de Produtos no chamado (P0)
**Status:** ✅ Concluído — migration aplicada em produção, `config_products` e `tickets.product_id` confirmados. Decidido: seleção única por chamado, lista simples sem ativo/inativo.

**Situação atual:** não existe nenhum campo de produto hoje, nem no banco nem na tela.

**Escopo esperado:** mesmo padrão dos demais itens configuráveis — tabela `config_products` (nome, ativo/inativo), campo no chamado (provavelmente múltiplo, já que um chamado pode envolver mais de um produto — **a confirmar no discovery**), tela de gerência em Configurações (que já nasce dentro do componente genérico do item 3, se este vier depois).

---

### 3. Refatorar tela de Configurações (P0)
**Status:** ✅ Sem trabalho de código pendente — escopo revisado

**Decisão do usuário:** **não unificar** Categoria, Tipo de Solicitação, Produtos e Tags num componente genérico. Cada um mantém sua própria tela/card, como já está hoje (Categorias/Tipo de Solicitação/Produtos em `system-config-content.tsx`, Tags em `tag-manager.tsx`, Filas em `/queues`). O requisito original deste item — "permitir que o usuário cadastre os itens nas configurações" — já está satisfeito para todos eles, então não há implementação pendente.

**Situação (referência, não mais um plano de refatoração):** existem hoje 5+ implementações separadas de CRUD parecido, sem componente genérico compartilhado (Categorias/Prioridades/Tipo de Solicitação/Produtos em `system-config-content.tsx`, Tags em `tag-manager.tsx`, Equipes em `app/(portal)/team/page.tsx`, Filas em `app/(portal)/queues/page.tsx`). Fica assim por decisão explícita — mantém cada tela simples e independente em vez de introduzir uma abstração genérica.

---

### 4. Lightbox de imagem único (P1)
**Status:** ✅ Concluído

**Situação (antes):** já existia um modal de ampliação de imagem reutilizável, `AttachmentPreviewModal` (`components/attachment-gallery.tsx`), usado no chamado e em outras telas. `components/chat-widget.tsx` duplicava sua própria versão inline (JSX do modal + uma segunda implementação de `openAttachmentInNewTab`) em vez de reaproveitar.

**Feito:** `chat-widget.tsx` agora importa e usa `AttachmentPreviewModal`/`openAttachmentInNewTab` de `attachment-gallery.tsx`; o JSX duplicado (~75 linhas) e a função local duplicada foram removidos, junto do import `Download` que ficou sem uso. `typecheck`/`build` limpos.

---

### 5. Botão "Enviar resposta pelo WhatsApp" no chamado (P1)
**Status:** 🟡 Implementado, aguardando teste — sem WhatsApp conectado no ambiente no momento da implementação. Testar assim que houver uma instância conectada: enviar uma resposta pelo botão novo, conferir que chega no WhatsApp do contato e que a mensagem fica registrada no chamado.

**Situação (antes):** o endpoint `/api/whatsapp/send` já existia e só era chamado pelo chat (`chat-widget.tsx`). A tela de chamado não tinha esse botão.

**Feito:** na aba "Conversa" do chamado, ao lado do botão "Enviar Resposta" (que só grava a mensagem visível ao cliente), adicionei "Enviar por WhatsApp" — grava a mesma mensagem e dispara pelo `/api/whatsapp/send`, resolvendo a instância pela Fila do chamado (`queues.whatsapp_instance_id`, fallback `'default'`), mesmo padrão já usado no chat. Só aparece na aba de mensagens do cliente (não em notas internas). Fica desabilitado com aviso ("Contato sem telefone cadastrado") quando o contato não tem telefone — não bloqueia nada, só avisa (mesmo padrão não-bloqueante do chat). Envio é só texto (HTML do editor convertido pra texto simples); se o WhatsApp falhar, a mensagem já ficou salva no chamado e só mostra um aviso não-bloqueante.

---

### 6. Documentar e deixar explícita a ordem da fila (P1)
**Status:** ✅ Concluído

**Situação (antes):** a fila já funcionava por **round-robin entre atendentes online** (`lib/services/queue-routing.ts`, função `pickNextQueueAssignee`): quem está com `is_online = true` entra no revezamento a partir do último atendente que recebeu um chat; sem ninguém online, cai como pendente para atribuição manual. Isso já era, na prática, "quem for ficando online vai pegando um lugar na fila" — mas não estava explicado em lugar nenhum da tela.

**Feito:** novo card "Como a fila distribui os atendimentos" em `app/(portal)/queues/page.tsx`, na barra lateral da tela de Filas, explicando em português claro: rodízio só entre quem está online, ordem segue a equipe cadastrada (pulando quem está offline), o que acontece se ninguém estiver online, e como funciona o pool combinado para chats do widget do portal sem WhatsApp vinculado (`include_internal_chats`).

**Ajuste de lógica adicional (pedido pelo usuário depois da 1ª entrega):** confirmado que "Ausente" já tira a pessoa do rodízio sem perder a posição (grava `is_online=false`, e a ordem-base em `member_ids` nunca muda — só documentado, sem mudança de código). Mas achamos uma inconsistência real: chat de WhatsApp (fila nomeada, rastreava "último atendido" por `queue_id`) e chat de login do funcionário (pool combinado, rastreava por conjunto de membros) tinham **ponteiros de "último atendido" separados**, podendo dar dois atendimentos quase juntos pro mesmo analista. Corrigido em `lib/services/queue-routing.ts` (`pickNextQueueAssignee`): agora os dois canais sempre compartilham o mesmo ponteiro, baseado só no conjunto de membros da fila, nunca no `queue_id` da sessão. Mantido: a opção "Recebe chats internos" continua existindo por fila (usuário optou por não remover o opt-out).

---

### 7. Histórico da conversa sob demanda (P2)
**Status:** ✅ Concluído — migration do índice aplicada e confirmada em produção. Aprovado pelo usuário.

**Situação (antes):** não existia painel de "histórico do cliente" embutido no atendimento. Existia só a página separada `app/(portal)/chat-history/page.tsx`, um log geral, sem filtro por contato.

**Decidido (resolvendo o [Decisão pendente]):** "atendimento anterior" aparece como **resumo** (data, duração, quem atendeu, nota da pesquisa se tiver) com um toggle "ver conversa" que carrega as mensagens completas daquela sessão sob demanda — não joga tudo misturado no scroll do chat atual.

**Feito:**
- Novo endpoint `GET /api/chats?action=previous-histories` (`app/api/chats/route.ts`), busca em `chat_histories` por `customer_id` OU `customer_phone` (com variantes de DDI), paginado (`limit`/`offset`, padrão 2), excluindo a sessão atual.
- `getPreviousChatHistories()` novo em `lib/services/chat-service.ts`.
- Botão "Carregar histórico anterior" no topo da área de mensagens do chat (`components/chat-widget.tsx`) — some quando não há mais histórico. Cada atendimento anterior vira um card colapsado; ao expandir, carrega as mensagens via `fetchSessionMessages` (já existente, reaproveitado sem alteração) e mostra em cache.
- Migration `migrations/chat_histories_phone_index.sql` (índice em `chat_histories.customer_phone`, que faltava) — aplicada e confirmada em produção.

---

### 8. "Histórico de chamados recentes" (P2)
**Status:** ✅ Concluído

**Situação (antes):** o modal de chamado já tinha "abas" (Histórico Cliente/Ticket Interno) — só que na prática eram filtros da mesma lista de mensagens do chamado (cliente vs. nota interna), não históricos de outros chamados.

**Decidido:** filtrar por **Empresa** (`company_id`), mostrando os chamados recentes de toda a empresa do cliente (não só desse contato). Lista curta (5) e só informativa — sem clicar para abrir outro chamado (exigiria navegação entre modais em várias páginas, fora de escopo; pode virar item futuro).

**Feito:** nova aba "Chamados Recentes" na mesma faixa de abas do painel direito, visível só pra equipe e só quando o chamado tem empresa vinculada. Novo `GET /api/tickets?action=recent-by-company` + `TicketService.getRecentByCompany()`, buscando os últimos chamados da empresa (excluindo o atual).

---

### 9. Duplicar o chat (P2)
**Status:** ✅ Concluído

**Situação (antes):** não existia função de "duplicar" — só o fluxo normal de "Finalizar" (que sempre exige criar um chamado).

**Resolvido (pontos que estavam em aberto):** o chat antigo **fica fechado/arquivado automaticamente** (mesmo mecanismo de `chat_histories` usado por "Finalizar", sem gerar chamado nem pesquisa de satisfação — não é uma despedida de verdade). O atendimento novo nasce **sem atribuição automática** (mesmo comportamento já usado por "Novo WhatsApp" hoje), o agente que duplicou continua sendo quem está com a tela aberta.

**Feito:** botão "Duplicar" no header do chat (ao lado de "Finalizar"), com modal de confirmação explicando o efeito. `handleDuplicateChat` em `components/chat-widget.tsx`: grava snapshot em `chat_histories`, fecha a sessão atual (`closeChatSessionAfterTicket`, sem janela de pesquisa), cria sessão nova pro mesmo contato (`createChatSession`) e seleciona ela automaticamente. Cliente não recebe nenhum aviso — só continua conversando, agora numa sessão nova. Sem mudanças de schema.

---

### 10. Permitir múltiplos chamados na mesma conversa (P2)
**Status:** ✅ Concluído — migration aplicada e confirmada em produção (corrigiu inclusive um erro que ela mesma causava em "Gerar Chamado" enquanto pendente).

**Correção em relação ao que estava registrado aqui:** não existia "constraint de FK única" nenhuma — conferido no schema, era só um bloqueio de aplicação (`chat-widget.tsx`), sem nada no banco impedindo. Mais simples do que parecia.

**Feito:** nova coluna `tickets.chat_session_id` (chamado → conversa de origem, N:1 — vários chamados podem vir da mesma conversa). `chat_sessions.ticket_id`/`ticket_number` continuam existindo, agora com o sentido de "chamado mais recente desta conversa" (mesmo badge exibido hoje, nenhuma tela precisou mudar). `saveTicketFromChatSession` (`app/actions.ts`) ganhou parâmetro `forceNew`; o bloqueio silencioso em `chat-widget.tsx` virou um popup de confirmação ("Abrir outro chamado?", reaproveitando o componente `ConfirmDialog` já existente) em vez de só avisar e travar.

---

### 11. Vincular chat a um chamado já existente (P2)
**Status:** ✅ Concluído — sem migration pendente (reaproveita `tickets.chat_session_id` do item 10).

**Situação (antes):** não existia ação de "vincular a chamado existente" — a vinculação só acontecia na criação do ticket.

**Feito:** botão "Vincular Chamado" no header do chat, abre `components/link-ticket-modal.tsx` (clonado do padrão já existente em `link-contact-modal.tsx`): busca chamados da mesma empresa do contato (por número ou título, endpoint `recent-by-company` estendido com parâmetro `search`), e ao escolher um, chama a nova action `linkChatSessionToTicket` (`app/actions.ts`) — atualiza `tickets.chat_session_id` do chamado escolhido e `chat_sessions.ticket_id/ticket_number` (vira o badge exibido no chat). Se o chamado escolhido já estava vinculado a outra conversa, mostra um aviso na lista ("Já vinculado a outra conversa") mas não bloqueia — é uma ação deliberada do atendente. Chat sem empresa vinculada mostra aviso pedindo pra associar um contato antes.

**Correção de bug encontrada no caminho:** o componente `ConfirmDialog` (compartilhado, usado em várias telas) tinha `z-index` menor que os modais do chat, fazendo o popup de confirmação do item 10 abrir atrás da tela — corrigido (`z-[200]` → `z-[400]`), beneficia todo lugar que usa o componente.

---

### 12. Mesclar e duplicar chamado (P2)
**Status:** ✅ Concluído — migration aplicada e confirmada em produção.

**Situação (antes):** já existia um fluxo de "Mesclar" na lista de chamados (seleção múltipla + botão + modal escolhendo o principal), mas era um placeholder incompleto: só fechava os chamados absorvidos (`status='Fechado'`) via `PATCH` normal, o que podia disparar notificação de "chamado fechado" via WhatsApp pro cliente de cada um deles (efeito colateral indesejado de uma operação interna). Não existia "Duplicar" em lugar nenhum.

**Decidido:** mensagens do chamado absorvido não são movidas (ficam onde estão); novo status dedicado **"Mesclado"** pro chamado absorvido (não reaproveita "Fechado"); tickets internos vinculados ao chamado absorvido continuam vinculados a ele (não são revinculados); duplicar copia dados cadastrais (fila, categoria, tipo, produto, empresa, contato, prioridade) + corpo (título/descrição), sem mensagens — nasce como um chamado novo relacionado.

**Feito:**
- Nova coluna `tickets.merged_into_id` (aponta pro chamado sobrevivente) e novo status `"Mesclado"` semeado em `config_statuses` (mesmo padrão dos demais status configuráveis, sem mexer em enum) — adicionado a `CLOSED_TICKET_STATUSES` pra sumir da lista padrão.
- `mergeTickets`/`duplicateTicket` novas em `app/actions.ts`, escrita direta via SQL (sem passar pelo `PATCH`/`POST` normal) — não disparam automação nem notificam o cliente. Mesclar também repontoa qualquer `chat_sessions` que apontava pro chamado absorvido (evita badge de chat morto) e grava uma mensagem de sistema em cada lado ("Chamado #X mesclado neste chamado" / "Este chamado foi mesclado no chamado #Y").
- Fluxo de "Mesclar" já existente na lista de chamados (`app/(portal)/tickets/page.tsx`) agora usa a action real em vez do placeholder.
- Botão "Duplicar" novo no cabeçalho do chamado (`ticket-detail-modal.tsx`), e aviso não-bloqueante no topo do modal quando o chamado aberto foi mesclado noutro.
- Corrigido de brinde: os endpoints de listagem de chamados (`/api/search`, usado pela lista principal) nunca mapeavam `queueId`/`categoryId`/`requestTypeId`/`productId`/`tags` pra camelCase — a Fila/Categoria provavelmente sempre aparecia em branco na lista (só funcionava dentro do modal do chamado, que usa outro endpoint).

---

### 13. Tela dedicada por empresa (P2)
**Status:** ✅ Concluído

**Situação (antes):** no chat, o campo "Empresa" já resolvia a empresa do contato (`chat-widget.tsx`), mas era só texto — não clicável. `app/(portal)/customers/page.tsx` lista empresas, mas não tinha uma visão de "todos os chamados e chats desta empresa"; não existia nenhuma rota dedicada por empresa (`/customers/[id]`).

**Feito:**
- Nova rota `app/(portal)/customers/[id]/page.tsx` (mesmo padrão client-side de `/tickets/[id]` e `/internal-tickets/[id]`) — mostra os chamados da empresa (paginados, "carregar mais") e os atendimentos, divididos em **Em andamento** e **Finalizados** (data, duração, atendente, nota).
- Novo endpoint `GET /api/tickets?action=by-company` + `TicketService.getByCompanyPaginated` — paginação real (offset+total), diferente do `recent-by-company` já existente (lista curta sem paginação, usado em outros lugares e mantido intacto).
- Novos endpoints `GET /api/chats?action=histories-by-company` e `action=sessions-by-company` + `getChatHistoriesByCompany`/`getActiveSessionsByCompany` em `lib/services/chat-service.ts`, reaproveitando os JOINs já usados nos itens 7/8.
- Campo "Empresa" no cabeçalho do chat agora é um link, abre a tela nova em nova aba (não tira o atendente do chat em andamento).
- Fora do escopo por decisão: sem filtro de status na lista de chamados (lista simples); atendimentos em andamento são só informativos, sem deep-link pra abrir a sessão específica no `/chat` (não existe esse mecanismo ainda).

---

### 14. Novas estratégias de fila configuráveis (P3)
**Status:** ✅ Concluído — migration aplicada e confirmada em produção.

**Situação (antes):** só existia a estratégia round-robin por status online (ver item 6), fixa, sem opção de troca.

**Decidido:** manter o round-robin como padrão; nova segunda opção, selecionável por fila e trocável a qualquer momento — **"Equilíbrio diário"**: manda o próximo atendimento pra quem tem menos `chat_sessions` recebidos no dia (todos os canais somados, mesma contagem unificada do item 6), nivelando a carga ao longo do turno em vez de só seguir a ordem fixa do rodízio. Empate é resolvido pela ordem cadastrada na equipe da fila.

**Feito:**
- Nova coluna `queues.routing_strategy` (`'round_robin'` default, ou `'daily_balance'`).
- `pickNextQueueAssignee` (`lib/services/queue-routing.ts`) bifurca por estratégia; round-robin fica inalterado, `daily_balance` conta chats de hoje por analista e escolhe o de menor contagem.
- Pool combinado de chats internos entre várias filas (`include_internal_chats`) continua sempre round-robin, deliberadamente — não há uma estratégia "dona" quando o pool mistura membros de filas diferentes.
- Novo seletor "Estratégia de Distribuição" no formulário de fila (`app/(portal)/queues/page.tsx`), badge "Equilíbrio Diário" na listagem quando ativo, e card explicativo atualizado.
- Corrigido de brinde: a coluna `include_internal_chats` (adicionada no item 6) nunca tinha sido refletida em `schema_postgres.sql`/`supabase_schema.sql` — sincronizado junto.

---

### 15. Tela de configuração de e-mail (SMTP) (P3)
**Status:** 🔲 Não iniciado

**Situação atual:** o sistema não tem nenhuma integração de e-mail hoje (sem SMTP, sem SendGrid/Resend/SES, sem nodemailer). Vocês têm um provedor, mas a confirmação final com a infra ainda está pendente.

**Escopo esperado (conforme combinado):** deixar a tela de configuração pronta mesmo antes da confirmação — campos para host/porta, usuário/senha ou API key, remetente padrão, teste de envio. Isso desacopla o trabalho de UI da resposta da infra: quando o provedor for confirmado, é só preencher e testar.

---

### 16. Disparo de e-mail (P3)
**Status:** 🔲 Não iniciado — bloqueado pela confirmação de infra do item 15

**Situação atual:** nenhum disparo de e-mail existe hoje. Notificação interna hoje é só via push (`lib/services/push-service.ts`) e polling (`app/api/notifications/check/route.ts`).

**Escopo esperado, duas frentes:**
- **Resposta ao cliente por e-mail** (interno e externo) a partir do chamado — análogo ao botão de WhatsApp do item 5.
- **Notificação de atribuição de novo ticket** por e-mail para o responsável interno — complementar ao push que já existe, não substitui.

Só pode ser implementado de fato depois que a infra confirmar as credenciais do provedor (item 15).

---

### 17. Cadastro de Hotfix / janela de release (P4)
**Status:** ✅ Concluído — migration aplicada e confirmada em produção. Implementado fora de ordem (adiantado a pedido, itens 15/16 ficaram pra depois por dependerem de confirmação de provedor de e-mail pela infra).

**Situação (antes):** não existia nenhuma feature de changelog/hotfix/release no sistema, nem nenhum mecanismo de alerta "baseado em prazo" (tudo no projeto só reage a eventos que já mudaram uma linha, nunca a "o tempo passou").

**Feito:**
- Nova tabela `hotfixes` (nome, descrição, responsável, data prevista, `published_at`, `alerted_at`) e nova tela `/hotfixes` (Configurações), com CRUD completo e "Marcar como Publicado" — mesmo padrão visual/estrutural de `/queues`.
- Nova permissão `HOTFIXES_MANAGE`, cadastrada em Equipes & Permissões e como item de menu próprio.
- Novo scheduler de fundo (`lib/services/hotfix-scheduler.ts`, registrado em `instrumentation-node.ts`, mesmo padrão de `automation-scheduler.ts` do item de automações) — a cada 5 minutos, marca hotfixes vencidos sem publicação (`alerted_at`) e dispara push pro responsável.
- Alerta também aparece no sino de notificação (polling), com ícone e cor próprios — mesmo mecanismo usado por chamado/ticket interno, sem precisar de tabela de notificação nova.
- Fora de escopo por decisão: alerta vai só pro responsável (não pra todo mundo com a permissão); sem toggle dedicado nas Configurações de Notificação por enquanto; "Marcar como Publicado" não tem "desfazer" pela UI.

---

## Perguntas em aberto (fora das já resolvidas)

Estas ainda não bloqueiam o início do roadmap, mas vão precisar de resposta quando chegarmos no item correspondente:

- **Item 2**: campo de Produto no chamado é de seleção única ou múltipla?
- **Item 7**: "histórico da conversa anterior" carrega a conversa inteira ou um resumo?
- **Item 9**: ao duplicar o chat, o atendimento antigo é arquivado automaticamente?
- **Item 12**: regras de mesclagem de chamados (o que acontece com mensagens/anexos/tickets internos do chamado absorvido).
- **Item 14**: métrica exata de "quantidade de mensagens" para a nova estratégia de fila, e quais outras estratégias vale a pena ter como opção.
- **Item 15/16**: qual provedor de e-mail a infra vai confirmar (SMTP próprio, Workspace, SendGrid, Resend, SES) — muda os campos da tela de configuração.
