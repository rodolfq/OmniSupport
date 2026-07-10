const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set!');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function main() {
  console.log('Adding attachments_data column to public.tickets...');
  try {
    await pool.query("ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachments_data JSONB DEFAULT '[]'::jsonb");
    console.log('✅ Column attachments_data added successfully to public.tickets!');
  } catch (err) {
    console.error('❌ Error adding column:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
