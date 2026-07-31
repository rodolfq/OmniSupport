# Roadmap de Melhorias — 2ª Rodada (Bitrix24 + IA)

> Documento interno de planejamento. Segunda rodada de melhorias, em conjunto com o time de Treinamento e o time de CS (Customer Success). Segue o mesmo formato do [`ROADMAP_MELHORIAS.md`](ROADMAP_MELHORIAS.md) (1ª rodada, concluída).
>
> Última atualização: 2026-07-31.

## Como usar este documento

- **Status** de cada item: `🔲 Não iniciado` / `🔵 Em implementação` / `🟡 Bloqueado (dependência externa)` / `✅ Concluído`.
- **Prioridade** é uma sugestão de ordem, não um compromisso de data.
- Segue o mesmo pipeline de trabalho por item já usado na 1ª rodada: seleção → discovery técnico → alinhamento → plano formal → implementação incremental → ajuste fino (ver `ROADMAP_MELHORIAS.md` para o detalhamento do pipeline).

---

## Prioridades (ordem sugerida)

| # | Prioridade | Item | Motivo da ordem |
|---|---|---|---|
| 1 | — | [Cadastro de cliente via Bitrix24](#1-cadastro-de-cliente-via-bitrix24) | Concluído |
| 2 | P0 | [Alinhar campos de sincronização com Treinamento e CS](#2-alinhar-campos-de-sincronização-com-treinamento-e-cs) | Bloqueia o refinamento do item 1 (quais campos sincronizar) e o item 3 (o que uma "ação com o cliente" precisa carregar para o Bitrix) |
| 3 | P0 | [Ações no SSX Desk refletidas no Bitrix (Chat + Chamado/CRM)](#3-ações-no-ssx-desk-refletidas-no-bitrix-chat--chamadocrm) | Item central desta rodada — depende de entender o modelo de tarefas do Bitrix, que ainda é discovery |
| 4 | P0 | [API oficial da Meta para o WhatsApp](#4-api-oficial-da-meta-para-o-whatsapp) | Bloqueado por terceiro (Jean) — não é esforço nosso, mas trava outras frentes de WhatsApp |
| 5 | P1 | [Definir provedor/custo oficial de IA para dados sensíveis](#5-definir-provedorcusto-oficial-de-ia-para-dados-sensíveis) | Decisão de produto/custo que os itens 6-10 (todos usam IA) idealmente esperam, para não migrar provedor duas vezes |
| 6 | P1 | [Resumo de atendimento/chat via IA](#6-resumo-de-atendimentochat-via-ia) | Menor escopo entre os itens de IA — bom ponto de entrada |
| 7 | P1 | [Resumo de chamados via IA](#7-resumo-de-chamados-via-ia) | Mesma família do item 6, reaproveita a mesma abordagem de sumarização |
| 8 | P1 | [Agente global para usuários](#8-agente-global-para-usuários) | Hoje o Agente de IA já existe e funciona — este item é sobre ampliar o alcance/permissão de quem acessa |
| 9 | P2 | [Detector de insatisfação do cliente](#9-detector-de-insatisfação-do-cliente) | Precisa de parâmetros de negócio (o que conta como "insatisfação") antes do discovery técnico — alinhar com CS |
| 10 | P2 | [Resumo de IA enviado ao cliente por WhatsApp no fechamento](#10-resumo-de-ia-enviado-ao-cliente-por-whatsapp-no-fechamento) | Depende dos itens 4 (envio oficial WhatsApp) e 7 (motor de resumo) estarem prontos primeiro |

---

## Status geral (resumo)

### ✅ Concluído

| # | Item | Observação |
|---|---|---|
| 1 | Cadastro de cliente via Bitrix24 | Sincronização manual implementada (botão "Sincronizar Bitrix24" em Empresas). Bônus: sincronização da equipe interna também implementada (nome, e-mail, telefone, foto), fora do escopo original do pedido |

### 🟡 Bloqueado (dependência externa)

| # | Item | Aguardando |
|---|---|---|
| 4 | API oficial da Meta para o WhatsApp | Jean — API Key da Meta oficial (desde 30/07) |

### 🔲 Não iniciado / aguardando alinhamento

| # | Item | Prioridade | Trava |
|---|---|---|---|
| 2 | Alinhar campos de sincronização com Treinamento e CS | P0 | Precisa cobrar Pedro (Treinamento) e Pedro (CS) |
| 3 | Ações no SSX Desk refletidas no Bitrix (Chat + Chamado/CRM) | P0 | Discovery técnico: como o Bitrix modela tarefas associadas a cliente |
| 5 | Definir provedor/custo oficial de IA para dados sensíveis | P1 | Decisão de produto/custo — hoje roda em chave de teste (Groq, gratuita) |
| 6 | Resumo de atendimento/chat via IA | P1 | — |
| 7 | Resumo de chamados via IA | P1 | — |
| 8 | Agente global para usuários | P1 | Definir critério de quem ganha acesso |
| 9 | Detector de insatisfação do cliente | P2 | Definir parâmetros com CS |
| 10 | Resumo de IA enviado ao cliente por WhatsApp no fechamento | P2 | Depende dos itens 4 e 7 |

---

## Detalhamento por item

### 1. Cadastro de cliente via Bitrix24
**Status:** ✅ Concluído

**Pedido original:** cadastro de cliente precisa vir do Bitrix (não ser digitado manualmente no SSX Desk).

**Feito:** botão "Sincronizar Bitrix24" na tela Empresas — busca `crm.company.list.json`, casa por nome exato, cria/atualiza. Webhook configurado (`BITRIX24_WEBHOOK_URL`). Sincronização é manual (sem job automático), por decisão explícita.

**Bônus (fora do pedido original):** sincronização da equipe interna via `user.get.json` do Bitrix — botão próprio em Gestão da Equipe, casa por e-mail exato, salva nome/e-mail/telefone/foto, cria como "Equipe" quem não existe.

**Em aberto:** o item 2 (quais campos exatos sincronizar) pode implicar ajustes neste fluxo já pronto — não é retrabalho do zero, é refinamento.

---

### 2. Alinhar campos de sincronização com Treinamento e CS
**Status:** 🔲 Não iniciado — ação de fora do código (conversa/alinhamento)

**Pedido original:** alinhar com Pedro quais campos sincronizar do cliente. Cobrar o Pedro do Treinamento e o Pedro do CS.

**Por que importa:** a sincronização do item 1 já roda, mas hoje só traz nome/indústria/telefone da empresa (o mínimo). Treinamento e CS podem depender de outros campos do Bitrix que ainda não são trazidos (ex.: segmento, responsável comercial, estágio do funil) — sem alinhar isso, corremos o risco de implementar o item 3 (ações → Bitrix) sem saber que dado o time realmente precisa ver do outro lado.

**Próximo passo:** não é técnico — é reunião/mensagem com os dois Pedros para levantar a lista de campos.

---

### 3. Ações no SSX Desk refletidas no Bitrix (Chat + Chamado/CRM)
**Status:** 🔲 Não iniciado — discovery técnico pendente

**Pedido original:** ações com o cliente no SSX Desk devem ir para o Bitrix (Chat e Chamado/CRM). Precisamos entender como transformar os chamados do SSX Desk em tarefas associadas aos clientes no Bitrix via integração.

**O que precisa ser descoberto antes de estimar:**
- Qual método da API do Bitrix cria uma "tarefa" (`tasks.task.add`?) e como ela é associada a uma empresa/contato do CRM (`crm.company`/`crm.contact` como `UF_CRM_TASK` ou vínculo de elemento CRM).
- Gatilho: toda mensagem de chamado vira uma atividade no Bitrix, ou só a abertura/fechamento do chamado vira uma tarefa?
- Sentido único (SSX Desk → Bitrix) ou os dois lados devem refletir mudanças (ex.: fechar a tarefa no Bitrix fecha o chamado)? Isso muda bastante o desenho (webhook de saída simples vs. integração bidirecional).
- Como evitar duplicidade em reenvio/erro de rede (idempotência — precisa gravar o ID da tarefa do Bitrix em algum lugar do nosso schema).

**Depende de:** item 2 (quais campos/contexto do chamado o Bitrix espera receber).

---

### 4. API oficial da Meta para o WhatsApp
**Status:** 🟡 Bloqueado — aguardando Jean (desde 30/07/2026)

**Pedido original:** API Key da Meta oficial para implementar a API do WhatsApp.

**Situação:** a integração via Meta Cloud API já está implementada no código (`app/api/whatsapp/webhook/route.ts`, `lib/services/meta-whatsapp-service.ts`) — é o caminho recomendado para produção, já que a conexão via Baileys/QR code não é confiável em hospedagem serverless (ver seção 11 do `CLAUDE.md`). Falta apenas a credencial oficial para ativar de fato.

**Próximo passo:** cobrar Jean pela API Key; sem isso não há nada a implementar do nosso lado.

---

### 5. Definir provedor/custo oficial de IA para dados sensíveis
**Status:** 🔲 Não iniciado — decisão de produto/custo, não técnica

**Pedido original:** falar sobre qual API usar para tratar dados sensíveis (Gemini?); hoje usa uma chave de testes; precisamos definir a oficial. Definir qual ferramenta e o custo.

**Situação atual:** o Agente de IA foi migrado de Gemini para **Groq** (não é mais Gemini) — a chave do Gemini tinha cota gratuita zerada e o usuário optou por uma alternativa 100% gratuita sem cartão. Hoje roda com uma chave pessoal de teste do Groq, tier gratuito (limite diário de tokens já mapeado e mitigado com redução de consumo — ver `ROADMAP_MELHORIAS.md`/histórico do Agente de IA).

**O que precisa de decisão:**
- Manter Groq gratuito (com os limites de tier free) ou migrar para um plano pago (Groq pago, OpenAI, Anthropic, ou outro) — cada opção tem trade-off diferente de custo x limite x tratamento de dado sensível.
- Se o critério "dados sensíveis" for um requisito formal (LGPD, cláusula contratual com cliente), precisa confirmar qual desses provedores tem certificação/contrato adequado — isso é uma pergunta para jurídico/compliance, não só técnica.
- Chave de teste pessoal não deve continuar em produção a longo prazo — precisa de uma chave/conta oficial da empresa.

**Próximo passo:** reunião de decisão (produto + custo), não código.

---

### 6. Resumo de atendimento/chat via IA
**Status:** 🔲 Não iniciado

**Pedido original:** resumo de atendimento/chat.

**Leitura do pedido:** ao final (ou sob demanda) de uma conversa de chat com o cliente, gerar um resumo automático do que foi tratado — útil para retomar contexto rapidamente (troca de analista, consulta posterior, etc.).

**Reaproveitamento técnico:** o Agente de IA já tem acesso de leitura a `chat_sessions`/`chat_messages` e já sumariza texto para as respostas de busca (`truncateText`, `lib/services/ai-assistant-service.ts`) — a infraestrutura de chamada ao modelo (Groq) já existe; este item é sobretudo um novo *prompt*/fluxo específico de sumarização, não uma integração nova.

---

### 7. Resumo de chamados via IA
**Status:** 🔲 Não iniciado

**Pedido original:** resumo de chamados.

**Leitura do pedido:** mesmo conceito do item 6, mas para o histórico de um chamado (mensagens + notas internas). Base direta para o item 10 (resumo enviado ao cliente no fechamento).

---

### 8. Agente global para usuários
**Status:** 🔲 Não iniciado — depende de definição de critério de acesso

**Pedido original:** agente global para usuários.

**Situação atual:** o widget do Agente de IA já existe e funciona (`components/ai-assistant-widget.tsx`), mas é restrito por permissão (`Permission.AI_ASSISTANT_USE`), hoje concedida a perfis de Equipe/Time Interno — não a todo usuário.

**O que precisa de decisão:** "global" significa todo analista/Time Interno (ampliar a concessão da permissão pelos perfis de acesso existentes — mudança de configuração, não de código) ou significa também clientes/funcionários (mudança de escopo maior: precisaria limitar o que o agente pode buscar por cliente, já que hoje ele tem visão ampla de chamados/tickets internos/chats de outras empresas).

---

### 9. Detector de insatisfação do cliente
**Status:** 🔲 Não iniciado — precisa de parâmetros de negócio antes do discovery técnico

**Pedido original:** definir parâmetros para que o agente identifique insatisfação do cliente no histórico de conversa.

**Por que este item é diferente dos outros de IA:** não é só "chamar o modelo com um prompt novo" — precisa que CS defina o que conta como sinal de insatisfação (palavras-chave, tom, avaliação baixa recorrente, reabertura de chamado, tempo de resposta, etc.) antes de desenhar o prompt/critério. Sem isso, o "detector" vira um palpite genérico do modelo, difícil de validar e de confiar.

**Próximo passo:** alinhamento com CS sobre os parâmetros — depois disso vira um item técnico normal (mesmo padrão dos itens 6/7, um novo prompt sobre dado já acessível ao agente).

---

### 10. Resumo de IA enviado ao cliente por WhatsApp no fechamento
**Status:** 🔲 Não iniciado — depende dos itens 4 e 7

**Pedido original:** a IA deve gerar um resumo de todo o chamado e chats associados a ele, e enviar esse resumo breve ao cliente quando o chamado for constatado como fechado (via WhatsApp).

**Dependências:**
- Item 7 (resumo de chamados via IA) — é o motor de geração do texto que este item dispara.
- Item 4 (API oficial da Meta) — o envio para o cliente precisa de um canal de WhatsApp confiável em produção; hoje o único caminho recomendado para serverless é a Meta Cloud API, ainda bloqueada.

**Ponto de atenção para o discovery futuro:** qual gatilho exato conta como "chamado fechado" — mudança de status para um `config_statuses` com `is_closed=true`, ou um status específico? E o que fazer se o chamado for reaberto depois do resumo já ter sido enviado (reenviar, não reenviar, enviar um novo resumo)?

---

## Achados desta rodada (fora de escopo dos itens acima)

| Onde | Observação |
|---|---|
| Chave do Agente de IA (Groq) | Hoje é uma chave de teste pessoal, sem tier oficial da empresa — ver item 5. Não é um bug, é uma pendência de decisão. |
