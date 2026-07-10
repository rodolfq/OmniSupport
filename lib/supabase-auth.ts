import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { query } from './db';

export const sessionDataCache = new Map<string, any>();

/**
 * Persistência de autenticação do Baileys no banco de dados Postgres próprio.
 * Mantemos o nome antigo da função para total compatibilidade com os arquivos consumidores (worker e service).
 */
export async function useSupabaseAuthState(unusedSupabaseClient: any, instanceId: string) {
  let row: any = null;
  
  try {
    const res = await query(
      'SELECT data FROM public.whatsapp_sessions WHERE id = $1',
      [instanceId]
    );
    if (res.rowCount && res.rowCount > 0) {
      row = res.rows[0];
    }
  } catch (fetchError) {
    console.error(`[PostgresAuth:${instanceId}] Erro ao buscar credenciais no Postgres:`, fetchError);
  }

  let sessionData: any = { creds: {}, keys: {} };
  
  if (row?.data) {
    try {
      sessionData = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
    } catch (e) {
      console.error(`[PostgresAuth:${instanceId}] Erro ao reviver dados de sessão do Baileys:`, e);
    }
  }

  // Credenciais padrão do Baileys
  if (!sessionData.creds || Object.keys(sessionData.creds).length === 0) {
    sessionData.creds = initAuthCreds();
  }
  if (!sessionData.keys) {
    sessionData.keys = {};
  }

  sessionDataCache.set(instanceId, sessionData);

  const writeToDb = async () => {
    try {
      const jsonStr = JSON.stringify(sessionData, BufferJSON.replacer);
      const dataToSave = JSON.parse(jsonStr);

      await query(
        `INSERT INTO public.whatsapp_sessions (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [instanceId, dataToSave]
      );
    } catch (e) {
      console.error(`[PostgresAuth:${instanceId}] Falha ao salvar credenciais no Postgres:`, e);
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
        let changed = false;
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}:${id}`;
            if (value) {
              sessionData.keys[key] = value;
            } else {
              delete sessionData.keys[key];
            }
            changed = true;
          }
        }
        if (changed) {
          await writeToDb();
        }
      }
    }
  };

  return {
    state,
    saveCreds: async () => {
      await writeToDb();
    }
  };
}
