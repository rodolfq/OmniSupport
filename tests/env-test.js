const fs = require('fs');
const path = require('path');

const ENV_TEST_PATH = path.join(__dirname, '..', '.env.test');

// Parser mínimo (KEY=VALUE por linha, aspas opcionais, # é comentário) — não
// usa a lib `dotenv` de propósito: aqui SEMPRE sobrescreve o process.env,
// porque lib/db.ts faz dotenv.config({ path: '.env' }) sem `override`, e
// precisamos ter certeza de que o valor de .env.test vence o do .env real
// (produção) quando o servidor de teste sobe.
function loadTestEnv() {
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error(`.env.test não encontrado em ${ENV_TEST_PATH} — sem ele o servidor de teste não sobe, para não arriscar herdar DATABASE_URL de produção.`);
  }

  const content = fs.readFileSync(ENV_TEST_PATH, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }

  assertSafeTestDatabase(process.env.DATABASE_URL);
}

// Rede de segurança independente de qualquer outra checagem: se por algum
// motivo DATABASE_URL não vier do .env.test (arquivo vazio, editado errado,
// variável de ambiente do shell vazando por cima), o processo recusa subir em
// vez de rodar teste que cria/edita dado contra um banco desconhecido.
function assertSafeTestDatabase(databaseUrl) {
  if (!databaseUrl || !/localhost:5433\/ssx_test(\?|$)/.test(databaseUrl)) {
    throw new Error(
      `DATABASE_URL de teste não bate com o esperado (postgresql://.../localhost:5433/ssx_test). ` +
      `Valor atual: ${databaseUrl || '(vazio)'}. Corrija .env.test — o servidor de teste nunca deve ` +
      `apontar pro banco real.`
    );
  }
}

module.exports = { loadTestEnv, assertSafeTestDatabase };
