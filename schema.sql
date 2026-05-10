-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    company_id TEXT,
    avatar_url TEXT,
    phone TEXT,
    password TEXT,
    must_change_password BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Grupos Internos
CREATE TABLE IF NOT EXISTS internal_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    type TEXT CHECK (type IN ('direct', 'group')) NOT NULL,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Membros dos Grupos
CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT REFERENCES internal_groups(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

-- Tabela de Mensagens do Chat Interno
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    group_id TEXT REFERENCES internal_groups(id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES users(id),
    sender_name TEXT NOT NULL,
    text TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    type TEXT CHECK (type IN ('text', 'system', 'file', 'gif', 'sticker')) NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Tabela de Confirmação de Leitura
CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_id ON chat_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

-- WhatsApp Sessions (Auth State)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
