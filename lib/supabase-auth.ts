import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { whatsappQuery } from './whatsapp-db';

export const sessionDataCache = new Map<string, any>();

function logPersistError(context: string, err: any, payloadPreview?: string) {
  console.error(`[PostgresAuth] ${context}:`, {
    message: err?.message,
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    where: err?.where,
    stack: err?.stack,
    ...(payloadPreview ? { payloadPreview: payloadPreview.slice(0, 500) } : {})
  });
}

/**
 * Persistência de autenticação do Baileys no banco de dados Postgres próprio.
 * Cada chave de sessão (creds, signal keys) é gravada em sua própria linha,
 * para que uma troca de mensagem grave apenas o que mudou, não o estado inteiro.
 * Mantemos o nome antigo da função para compatibilidade com os consumidores.
 */
export async function useSupabaseAuthState(unusedSupabaseClient: any, instanceId: string) {
  const credsId = instanceId;
  const keyRowPrefix = `${instanceId}:key:`;

  let creds: any = null;
  const keys: { [key: string]: any } = {};

  try {
    const res = await whatsappQuery(
      `SELECT id, data FROM public.whatsapp_sessions WHERE id = $1 OR id LIKE $2`,
      [credsId, `${keyRowPrefix}%`]
    );

    for (const row of res.rows) {
      if (row.id === credsId) {
        creds = JSON.parse(JSON.stringify(row.data?.creds ?? row.data), BufferJSON.reviver);
      } else if (row.id.startsWith(keyRowPrefix)) {
        const keyName = row.id.slice(keyRowPrefix.length);
        keys[keyName] = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
      }
    }
  } catch (fetchError) {
    console.error(`[PostgresAuth:${instanceId}] Erro ao buscar credenciais no Postgres:`, fetchError);
  }

  if (!creds || Object.keys(creds).length === 0) {
    creds = initAuthCreds();
  }

  const sessionData = { creds, keys };
  sessionDataCache.set(instanceId, sessionData);

  const writeCreds = async () => {
    let serialized = '';
    try {
      serialized = JSON.stringify(sessionData.creds, BufferJSON.replacer);
      // Serializamos explicitamente e fazemos cast para jsonb: assim garantimos que o
      // texto enviado ao Postgres é sempre um JSON válido gerado por nós, em vez de
      // depender da serialização implícita do driver `pg` para objetos JS.
      await whatsappQuery(
        `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [credsId, serialized]
      );
    } catch (e) {
      logPersistError(`[${instanceId}] Falha ao salvar credenciais`, e, serialized);
    }
  };

  const writeKey = async (keyName: string, value: any) => {
    const id = `${keyRowPrefix}${keyName}`;
    let serialized = '';
    try {
      if (value == null) {
        await whatsappQuery('DELETE FROM public.whatsapp_sessions WHERE id = $1', [id]);
        return;
      }
      serialized = JSON.stringify(value, BufferJSON.replacer);
      await whatsappQuery(
        `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [id, serialized]
      );
    } catch (e) {
      logPersistError(`[${instanceId}] Falha ao salvar chave "${keyName}"`, e, serialized);
    }
  };

  const state = {
    creds: sessionData.creds,
    keys: {
      get: (type: string, ids: string[]) => {
        const data: { [id: string]: any } = {};
        for (const id of ids) {
          const value = sessionData.keys[`${type}:${id}`];
          if (value) {
            data[id] = value;
          }
        }
        return data;
      },
      set: async (data: { [category: string]: { [id: string]: any } }) => {
        const writes: Promise<void>[] = [];
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}:${id}`;
            if (value) {
              sessionData.keys[key] = value;
            } else {
              delete sessionData.keys[key];
            }
            writes.push(writeKey(key, value));
          }
        }
        if (writes.length) {
          await Promise.all(writes);
        }
      }
    }
  };

  return {
    state,
    saveCreds: async () => {
      await writeCreds();
    }
  };
}
