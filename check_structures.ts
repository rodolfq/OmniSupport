import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
