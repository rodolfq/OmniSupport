const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  try {
    const ticketRes = await pool.query('SELECT * FROM public.tickets LIMIT 1');
    if (ticketRes.rowCount === 0) {
      console.log('No tickets in DB to test');
      return;
    }
    const ticket = ticketRes.rows[0];
    
    // We will make a POST request to the local API compatibility layer
    const url = 'http://localhost:3000/api/compat/supabase';
    const payload = {
      table: 'tickets',
      action: 'update',
      payload: {
        title: ticket.title,
        description: ticket.description,
        status: 'Em Andamento',
        priority: ticket.priority,
        category: ticket.category,
        company_id: ticket.company_id,
        customer_id: ticket.customer_id,
        assignee_id: ticket.assignee_id,
        updated_at: new Date().toISOString()
      },
      filters: [
        { type: 'eq', col: 'id', val: ticket.id }
      ],
      orderBy: null,
      limitCount: null,
      isSingle: false,
      isMaybeSingle: false
    };

    console.log('Sending request to /api/compat/supabase...');
    const response = await axios.post(url, payload);
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
  } catch (err) {
    if (err.response) {
      console.error('API Error Response:', err.response.status, err.response.data);
    } else {
      console.error('Request failed:', err.message);
    }
  } finally {
    await pool.end();
  }
}

main();
