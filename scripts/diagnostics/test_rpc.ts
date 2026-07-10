import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
