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
  console.log('Adding status column to public.analyst_status...');
  try {
    await pool.query("ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline'");
    console.log('✅ Column status added successfully!');
  } catch (err) {
    console.error('❌ Error adding column:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
