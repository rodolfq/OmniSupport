import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function runMigration() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("Lendo arquivo de migração...");
    const migrationSql = fs.readFileSync(path.join(__dirname, 'add_sequential_ticket_id.sql'), 'utf-8');
    
    console.log("Executando migração...");
    await client.query(migrationSql);
    console.log("Migração executada com sucesso!");
    
  } catch (err) {
    console.error("Erro ao executar migração:", err);
  } finally {
    await client.end();
  }
}

runMigration();
