# Arquitetura e Funcionamento do OmniSupport

Este documento descreve detalhadamente o funcionamento interno, arquitetura, fluxos de dados e banco de dados do sistema **OmniSupport**.

---

## 🛠️ 1. Visão Geral da Stack e Estrutura
- **Framework**: Next.js 15 (App Router).
- **Estilização**: Tailwind CSS v4, Motion (animações).
- **Banco de Dados**: PostgreSQL Nativo (executando localmente ou em servidor compartilhado).
- **Bibliotecas Principais**:
  - `@whiskeysockets/baileys` (Conexão e emulação do WhatsApp Web socket).
  - `pg` (driver do PostgreSQL).
  - `axios` (chamadas HTTP externas).

---

## 💾 2. Banco de Dados e Modelo Relacional
O banco de dados PostgreSQL possui tabelas essenciais para o gerenciamento de perfis, chamados, chats de WhatsApp e controle de SLA:

1. **`profiles`**: Usuários do sistema. O campo `role` define a alçada:
   - `'Administrador'`: Acesso total.
   - `'Equipe'`: Analistas de suporte técnico.
   - `'Time Interno'`: Equipes internas de desenvolvimento/infra.
   - `'Cliente'`: Usuários finais que abrem chamados.
2. **`companies`**: Empresas às quais os clientes pertencem.
3. **`tickets`**: Chamados criados.
   - Armazena metadados básicos: `title`, `description`, `status`, `priority`, `category`.
   - Ligações relacionais: `company_id`, `customer_id` (quem abriu), `assignee_id` (técnico responsável).
   - `attachments_data` (JSONB): Array contendo informações estruturadas de arquivos anexados no chamado.
4. **`ticket_messages`**: Mensagens internas e públicas trocadas no histórico de um chamado.
5. **`chat_sessions`** e **`chat_messages`**: Sessões e mensagens de chat síncrono. São criadas e atualizadas automaticamente na recepção de mensagens do WhatsApp.
6. **`whatsapp_sessions`** e **`whatsapp_instances`**: Guarda o token de acesso (para a API da Meta) ou as credenciais de autenticação persistidas do Baileys (sessão do WhatsApp Web).
7. **`internal_tickets`**: Chamados de uso exclusivo da equipe de desenvolvimento interna.

---

## 🔄 3. Camada de Compatibilidade do Supabase (O Coração da Transição)
O projeto originalmente utilizava o **Supabase** como BaaS (Backend-as-a-Service) e continha diversas chamadas de banco no frontend escritas no padrão `supabase.from('table').select(...)`. 

Para migrar para o PostgreSQL próprio sem precisar reescrever todo o frontend, foi criada uma camada de compatibilidade engenhosa:
1. **Cliente Falso ([/lib/supabase.ts](file:///c:/Users/rafael/OmniSupport/lib/supabase.ts))**: O cliente importado nos arquivos finge ser o Supabase JS Client, mas converte as encadeações de métodos (como `.select().eq().order()`) em um payload JSON estruturado.
2. **API Endpoint ([/app/api/compat/supabase/route.ts](file:///c:/Users/rafael/OmniSupport/app/api/compat/supabase/route.ts))**: Recebe esse payload JSON por uma requisição HTTP `POST`, traduz dinamicamente a chamada para comandos SQL equivalentes (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, cláusulas `WHERE`, etc.) e executa no Postgres.
3. **Conversão de UUIDs**: Para evitar erros do Postgres ao receber strings vazias (`""`) em colunas de chaves estrangeiras (UUID), a API do emulador limpa dados e transforma `""` em `null` para qualquer coluna terminada em `_id` ou de nome `id`.

---

## 💬 4. Fluxo de Integração do WhatsApp
Existem dois caminhos distintos no código para lidar com o WhatsApp:

### A. Integração Não-Oficial (QR Code / Baileys)
- **Local/Desenvolvimento**: Roda através do arquivo [/lib/services/whatsapp-service.ts](file:///c:/Users/rafael/OmniSupport/lib/services/whatsapp-service.ts) ou do script dedicado [/scripts/whatsapp-worker.ts](file:///c:/Users/rafael/OmniSupport/scripts/whatsapp-worker.ts).
- **Como funciona**: Abre uma conexão WebSocket persistente com os servidores do WhatsApp. Ao receber uma mensagem (`messages.upsert`), o código:
  1. Extrai o JID (número do remetente).
  2. Executa a expansão e busca por variantes de telefone do Brasil (com/sem DDI `55`, com/sem o nono dígito `9`), localizando ou criando a `chat_session`.
  3. Insere a mensagem na tabela `chat_messages` e atualiza a última data na sessão.
- **Produção (Serverless)**: Como o ambiente serverless (ex: Vercel) desliga processos inativos, o Baileys não pode rodar diretamente na API Next.js. O worker (`whatsapp-worker.ts`) deve ser hospedado separadamente em um servidor persistente (como VPS, Railway ou Render) conectado ao mesmo banco de dados PostgreSQL.

### B. Integração Oficial (Meta Cloud API / Webhook)
- **Como funciona**: Meta envia um `POST` contendo os dados da mensagem ao endpoint `/api/whatsapp/webhook` toda vez que um cliente envia algo.
- **Status**: Tratado pelo arquivo [/lib/services/meta-whatsapp-service.ts](file:///c:/Users/rafael/OmniSupport/lib/services/meta-whatsapp-service.ts). Ele processa a lista de mensagens (`entry.changes.value.messages`), extrai o número do remetente (`from`), executa a busca pelas variantes de 9º dígito e insere diretamente no banco Postgres via queries SQL nativas. Esse fluxo funciona 100% de forma serverless.

---

## 🕒 5. Lógica de SLA e Timezones
- **Fuso Horário do Banco**: O banco de dados opera sob o fuso da conexão de host (tipicamente America/Sao_Paulo). As datas padrão no banco são registradas com a função `NOW()` para manter a precisão absoluta do timestamp.
- **Exibição Frontend**: Para evitar conflitos de renderização no lado do servidor do Next.js (Hydration Mismatch), a formatação das datas no navegador é feita dinamicamente usando o componente `<ClientTime>` (`components/client-time.tsx`), que converte o UTC absoluto recebido do banco para o fuso local do dispositivo do usuário através de um gancho `useEffect`.
