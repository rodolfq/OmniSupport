const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  try {
    // 1. Let's find an existing ticket
    const ticketRes = await pool.query('SELECT * FROM public.tickets LIMIT 1');
    if (ticketRes.rowCount === 0) {
      console.log('No tickets in DB to test');
      return;
    }
    const ticket = ticketRes.rows[0];
    console.log('Testing update on ticket:', ticket.id, 'with status:', ticket.status);

    // 2. Perform the update query exactly as in API PUT
    const sql = `UPDATE public.tickets
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           company_id = COALESCE($5, company_id),
           customer_id = COALESCE($6, customer_id),
           assignee_id = $7,
           updated_at = NOW()
       WHERE id = $8`;
    
    // Simulate updating status to "Em Andamento"
    const params = [
      ticket.title,
      ticket.description,
      'Em Andamento', // status
      ticket.priority,
      ticket.company_id,
      ticket.customer_id,
      ticket.assignee_id,
      ticket.id
    ];

    console.log('Executing query...');
    await pool.query(sql, params);
    console.log('Update query succeeded!');
  } catch (err) {
    console.error('Database query failed:', err);
  } finally {
    await pool.end();
  }
}

main();
