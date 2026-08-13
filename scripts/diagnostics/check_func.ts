import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkFunction() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Definição da função 'handle_new_user' ---");
    const result = await client.query(`
      SELECT routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'handle_new_user';
    `);
    console.log(result.rows[0]?.routine_definition);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkFunction();
