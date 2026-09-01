-- Cursor de quando a avaliação (rating) foi de fato registrada, usado pelo
-- polling de notificação no sino (avaliação positiva/negativa) — created_at
-- é fixado no fechamento do chamado e não serve pra isso, pois a nota chega
-- depois, quando o cliente responde "1"/"0".
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS rating_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_chat_histories_rating_at ON public.chat_histories(rating_at) WHERE rating_at IS NOT NULL;
