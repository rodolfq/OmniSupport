import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkConfigTables() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Estrutura 'config_categories' ---");
    const catResult = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'config_categories';`);
    console.table(catResult.rows);
    
    console.log("\n--- Estrutura 'config_priorities' ---");
    const prioResult = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'config_priorities';`);
    console.table(prioResult.rows);
    
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkConfigTables();
