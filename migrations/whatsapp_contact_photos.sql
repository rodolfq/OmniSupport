-- Persistência da foto de perfil do WhatsApp por contato, para não precisar
-- consultar o WhatsApp novamente depois que a foto já foi obtida com sucesso.
CREATE TABLE IF NOT EXISTS public.whatsapp_contact_photos (
  instance_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (instance_id, phone)
);
