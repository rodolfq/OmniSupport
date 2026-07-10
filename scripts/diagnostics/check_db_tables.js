const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('--- TABLES IN POSTGRES ---');
    res.rows.forEach(r => console.log(r.table_name));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
