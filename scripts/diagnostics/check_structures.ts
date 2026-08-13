import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkStructures() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Estrutura 'companies' ---");
    const companies = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'companies'");
    console.table(companies.rows);
    
    console.log("\n--- Estrutura 'tickets' ---");
    const tickets = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tickets'");
    console.table(tickets.rows);
    
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkStructures();
