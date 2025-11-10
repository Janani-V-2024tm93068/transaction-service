const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8083;
app.use(bodyParser.json());

// ------------------------------
// DATABASE CONNECTION
// ------------------------------
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// ------------------------------
// ROOT & HEALTH CHECK ENDPOINTS
// ------------------------------
app.get('/', (req, res) => res.send('Transaction Service running ✅'));

// ✅ Health endpoint for Kubernetes probes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'transaction-service' });
});

// DB Connectivity Check
app.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.send(`✅ DB Connected for TRANSACTION SERVICE! Server time now: ${result.rows[0].now}`);
  } catch (err) {
    res.status(500).send('❌ DB connection failed: ' + err.message);
  }
});

// ------------------------------
// CRUD ENDPOINTS FOR TRANSACTIONS
// ------------------------------

// CREATE a transaction (deposit, withdraw, or transfer)
app.post('/transactions', async (req, res) => {
  const { account_id, amount, txn_type, counterparty, reference } = req.body;

  try {
    // Business rule: demo-only (no shared DB for balance validation)
    if (txn_type === 'withdraw') {
      console.log('⚠️ Withdraw transaction received - skipping balance validation for demo.');
    }

    // Insert transaction record
    const result = await pool.query(
      'INSERT INTO transactions (account_id, amount, txn_type, counterparty, reference) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [account_id, amount, txn_type, counterparty, reference]
    );

    const transaction = result.rows[0];

    // ------------------------------
    // CALL NOTIFICATION SERVICE
    // ------------------------------
    const notificationBaseUrl =
      process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:8084';
    const notificationUrl = `${notificationBaseUrl}/notify`;
    const SERVICE_API_KEY = process.env.SERVICE_API_KEY || 'banking-shared-key';

    try {
      const message = `💸 ${txn_type.toUpperCase()} of ₹${amount} processed successfully for Account ID ${account_id}`;
      await axios.post(
        notificationUrl,
        {
          account_id,
          message,
          channel: 'email',
          status: 'sent'
        },
        {
          headers: { 'x-api-key': SERVICE_API_KEY }
        }
      );
      console.log(`📨 Notification sent to Notification Service for txn ${transaction.txn_id}`);
    } catch (notifyErr) {
      console.error('⚠️ Failed to send notification:', notifyErr.message);
    }

    res.status(201).json({
      message: '✅ Transaction recorded successfully & notification triggered',
      transaction
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ all transactions
app.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY txn_id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ transaction by ID
app.get('/transactions/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions WHERE txn_id = $1', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Transaction not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE transaction by ID
app.delete('/transactions/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM transactions WHERE txn_id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Transaction not found' });
    res.json({ message: '🗑️ Transaction deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// START SERVER
// ------------------------------
app.listen(port, () => console.log(`🚀 Transaction Service running on port ${port}`));
