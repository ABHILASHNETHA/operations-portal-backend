// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. PostgreSQL Database Connection Configuration
// Replace the old const pool = new Pool({...}) block with this:
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_DCkisY9I2KjM@ep-summer-cherry-apslezdn.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false } // Required for secure cloud connections
});

// Initialize Database Tables
const initDb = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            ldap VARCHAR(50) PRIMARY KEY,
            password TEXT NOT NULL,
            role VARCHAR(20) NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tickets (
            id SERIAL PRIMARY KEY,
            l0_ldap VARCHAR(50),
            timestamp VARCHAR(50),
            item_id VARCHAR(50),
            revision_id VARCHAR(50),
            query_text TEXT,
            status VARCHAR(20) DEFAULT 'PENDING',
            verdict VARCHAR(50) DEFAULT '',
            crx_ldap VARCHAR(50) DEFAULT '',
            last_updated VARCHAR(50) DEFAULT ''
        );
    `);
    
    // Seed default admin account if table is empty
    const res = await pool.query('SELECT * FROM users WHERE ldap = $1', ['admin']);
    if (res.rowCount === 0) {
        await pool.query('INSERT INTO users (ldap, password, role) VALUES ($1, $2, $3)', ['admin', 'admin123', 'ADMIN']);
    }
};
initDb().catch(err => console.error("Database initialization failed:", err));

// 2. API Endpoints

// Authentication API
app.post('/api/login', async (req, res) => {
    const { ldap, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE ldap = $1', [ldap]);
        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'UNRECOGNIZED' });
        }
        if (userRes.rows[0].password !== password) {
            return res.status(401).json({ error: 'WRONG_PASSWORD' });
        }
        res.json({ ldap: userRes.rows[0].ldap, role: userRes.rows[0].role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit Ticket API
app.post('/api/tickets', async (req, res) => {
    const { l0_ldap, timestamp, item_id, revision_id, query_text } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO tickets (l0_ldap, timestamp, item_id, revision_id, query_text) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [l0_ldap, timestamp, item_id, revision_id, query_text]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch Paginated Tickets API (Crucial for handling 10,000+ entries)
app.get('/api/tickets', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const filter = req.query.filter || 'ALL';

    try {
        let queryStr = `SELECT * FROM tickets WHERE (LOWER(l0_ldap) LIKE $1 OR LOWER(item_id) LIKE $1)`;
        let countStr = `SELECT COUNT(*) FROM tickets WHERE (LOWER(l0_ldap) LIKE $1 OR LOWER(item_id) LIKE $1)`;
        let params = [`%${search.toLowerCase()}%`];

        if (filter !== 'ALL') {
            const statusVal = filter === 'RESOLVED' ? 'RESOLVED' : 'PENDING';
            queryStr += ` AND status = $2`;
            countStr += ` AND status = $2`;
            params.push(statusVal);
        }

        const countRes = await pool.query(countStr, params);
        const totalRecords = parseInt(countRes.rows[0].count);

        // Add sorting and pagination restrictions
        queryStr += ` ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const dataRes = await pool.query(queryStr, params);
        
        res.json({
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: page,
            data: dataRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Ticket Verdict API
app.put('/api/tickets/:id', async (req, res) => {
    const { id } = req.params;
    const { crx_ldap, verdict, status, last_updated } = req.body;
    try {
        const result = await pool.query(
            `UPDATE tickets SET crx_ldap = $1, verdict = $2, status = $3, last_updated = $4 WHERE id = $5 RETURNING *`,
            [crx_ldap, verdict, status, last_updated, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch Active User List API
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT ldap, role FROM users ORDER BY ldap ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create User Profile Entry API
app.post('/api/users', async (req, res) => {
    const { ldap, password, role } = req.body;
    try {
        const existCheck = await pool.query('SELECT ldap FROM users WHERE ldap = $1', [ldap]);
        if(existCheck.rowCount > 0) return res.status(400).json({ error: 'User profiles entry already exists!' });

        await pool.query('INSERT INTO users (ldap, password, role) VALUES ($1, $2, $3)', [ldap, password, role]);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('Backend Services Gateway active on port 3000'));