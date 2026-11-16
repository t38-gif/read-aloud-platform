const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

let usePostgres = false;
let pool = null;
let db = null;

if (process.env.DATABASE_URL) {
    usePostgres = true;
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    db = new sqlite3.Database('./read_aloud.db');
}

// Configure Automated System Mailer (Gmail SMTP or any SMTP provider)
let mailTransporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function initDB() {
    if (usePostgres) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS submissions (
                    id SERIAL PRIMARY KEY,
                    student_id INT NOT NULL,
                    student_name VARCHAR(255) NOT NULL DEFAULT 'Unknown',
                    student_email VARCHAR(255) DEFAULT '',
                    audio_file_path TEXT NOT NULL,
                    transcript TEXT DEFAULT '',
                    score INT DEFAULT 0,
                    mispronounced_words TEXT NOT NULL DEFAULT '',
                    week_number INT NOT NULL,
                    year INT NOT NULL,
                    submitted_at TIMESTAMP DEFAULT
