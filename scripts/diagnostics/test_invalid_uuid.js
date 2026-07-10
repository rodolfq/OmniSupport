const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  try {
    const res = await pool.query(`
      UPDATE public.tickets
      SET company_id = $1
      WHERE id = $2
    `, ['', 'ex-ticket-payment-error']);
    console.log('Result:', res.rows);
  } catch (err) {
    console.error('Expected error occurred:', err.message);
  } finally {
    await pool.end();
  }
}

main();
