import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
