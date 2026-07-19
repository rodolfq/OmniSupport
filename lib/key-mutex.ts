// Mutex em memória por chave — serializa chamadas concorrentes que compartilham
// a mesma chave (ex.: mesmo telefone), sem bloquear chaves diferentes. Usado
// pelas duas integrações de WhatsApp (Baileys e Meta Cloud API) para evitar
// que duas mensagens quase simultâneas da mesma pessoa criem duas sessões de
// chat em paralelo (cada chamada faria seu SELECT antes da outra terminar o
// INSERT). Só vale dentro deste processo Node — ver ON CONFLICT no INSERT de
// chat_sessions para a rede de segurança entre processos/instâncias.
const locks = new Map<string, Promise<unknown>>();

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const guarded = run.catch(() => {});
  locks.set(key, guarded);
  guarded.finally(() => {
    if (locks.get(key) === guarded) locks.delete(key);
  });
  return run;
}
