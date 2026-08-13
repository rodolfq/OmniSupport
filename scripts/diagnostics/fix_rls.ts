import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function fixRLS() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Criando política para 'companies' ---");
    await client.query(`
      CREATE POLICY "Allow authenticated read" ON companies
      FOR SELECT
      TO authenticated
      USING (true);
    `);
    console.log("Política criada com sucesso.");
  } catch (err) {
    console.error("Erro ao criar política:", err);
  } finally {
    await client.end();
  }
}

fixRLS();
