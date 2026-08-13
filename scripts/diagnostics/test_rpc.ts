import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function testRPC() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log("Conectado. Testando RPC...");
    
    // Test the RPC
    const result = await client.query("SELECT create_user_account('test2@test.com', 'pass123', 'Test User', 'Funcionário')");
    console.log("Resultado RPC:", result.rows[0]);
    
  } catch (err) {
    console.error("Erro no RPC:", err);
  } finally {
    await client.end();
  }
}

testRPC();
