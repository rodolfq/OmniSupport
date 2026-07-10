const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
console.log('Connecting to:', connectionString ? 'Configured URL' : 'undefined');

const pool = new Pool({ connectionString });

pool.query('SELECT NOW()')
  .then(r => console.log('✅ Pool connection successful! DB Time:', r.rows[0].now))
  .catch(err => console.error('❌ Pool connection failed:', err))
  .finally(() => pool.end());
