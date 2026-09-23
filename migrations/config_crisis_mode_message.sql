-- Mensagem do Modo de Crise deixa de ser fixa no código — editável em
-- Configurações > Sistema. NULL/vazio cai no texto padrão
-- (lib/crisis-mode-message.ts), nunca manda mensagem em branco.
ALTER TABLE public.config_crisis_mode ADD COLUMN IF NOT EXISTS message TEXT;
