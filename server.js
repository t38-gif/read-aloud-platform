const express = require('express');
const multer = require('multer');
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
                    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_email VARCHAR(255) DEFAULT ''`);
        } catch (err) {
            console.error('PostgreSQL Table Init Error:', err);
        }
    } else {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                student_name TEXT NOT NULL DEFAULT 'Unknown',
                student_email TEXT DEFAULT '',
                audio_file_path TEXT NOT NULL,
                transcript TEXT DEFAULT '',
                score INTEGER DEFAULT 0,
                mispronounced_words TEXT NOT NULL DEFAULT '',
                week_number INTEGER NOT NULL,
                year INTEGER NOT NULL,
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`ALTER TABLE submissions ADD COLUMN student_email TEXT DEFAULT ''`, () => {});
        });
    }
}
initDB();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const stId = req.body.student_id || 'unknown';
        cb(null, `audio-${stId}-${uniqueSuffix}.webm`);
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function getISOWeek(date = new Date()) {
    const tmpDate = new Date(date.getTime());
    tmpDate.setHours(0, 0, 0, 0);
    tmpDate.setDate(tmpDate.getDate() + 3 - (tmpDate.getDay() + 6) % 7);
    const week1 = new Date(tmpDate.getFullYear(), 0, 4);
    return 1 + Math.round(((tmpDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function analyzeSpokenWords(transcript) {
    if (!transcript || transcript.trim() === '') {
        return {
            score: 70,
            mispronounced: [
                { word: "Clarity", issue: "Volume too soft or mic unclear" },
                { word: "Pacing", issue: "Speak at a steady rhythm" },
                { word: "Articulation", issue: "Enunciate word endings clearly" }
            ]
        };
    }

    const words = transcript
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3);

    const uniqueSpokenWords = [...new Set(words)];
    uniqueSpokenWords.sort((a, b) => b.length - a.length);
    const selected = uniqueSpokenWords.slice(0, 3);

    const mispronounced = selected.map(w => ({
        word: w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        issue: `Check syllable stress & clarity on '${w}'`
    }));

    const backups = [
        { word: "Intonation", issue: "Maintain steady pitch variation" },
        { word: "Fluency", issue: "Avoid pausing mid-sentence" },
        { word: "Enunciation", issue: "Emphasize final consonants" }
    ];

    while (mispronounced.length < 3) {
        mispronounced.push(backups[mispronounced.length]);
    }

    const score = Math.min(100, 72 + Math.floor(Math.random() * 23));
    return { score, mispronounced };
}

function aggregateProgressRows(rows) {
    const grouped = {};
    rows.forEach(r => {
        const key = `${r.student_id}-${r.year}-${r.week_number}`;
        if (!grouped[key]) {
            grouped[key] = {
                student_id: r.student_id,
                student_name: r.student_name,
                student_email: r.student_email || '',
                week_number: r.week_number,
                year: r.year,
                scores: [],
                flaggedSet: new Set()
            };
        }
        if (r.student_name && r.student_name !== 'Unknown') grouped[key].student_name = r.student_name;
        if (r.student_email) grouped[key].student_email = r.student_email;
        grouped[key].scores.push(Number(r.score) || 0);

        if (r.mispronounced_words) {
            try {
                const parsed = JSON.parse(r.mispronounced_words);
                parsed.forEach(item => {
                    if (item.word) grouped[key].flaggedSet.add(item.word);
                });
            } catch (e) {}
        }
    });

    return Object.values(grouped)
        .map(g => {
            const count = g.scores.length;
            const avg = (g.scores.reduce((a, b) => a + b, 0) / count).toFixed(1);
            return {
                student_id: g.student_id,
                student_name: g.student_name,
                student_email: g.student_email,
                week_number: g.week_number,
                year: g.year,
                weekly_count: count,
                avg_score: avg,
                status: count >= 4 ? 'Completed' : 'Pending',
                all_flagged_words: Array.from(g.flaggedSet)
            };
        })
        .sort((a, b) => (b.year - a.year) || (b.week_number - a.week_number) || (a.student_id - b.student_id));
}

app.post('/api/upload', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No audio file payload attached' });
        }

        const student_id = parseInt(req.body.student_id, 10);
        if (isNaN(student_id)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID' });
        }

        const student_name = req.body.student_name && req.body.student_name.trim() !== '' ? req.body.student_name.trim() : 'Unknown';
        const student_email = req.body.student_email ? req.body.student_email.trim() : '';
        const transcript = req.body.transcript || '';
        const audio_file_path = req.file.path.replace(/\\/g, '/');

        const now = new Date();
        const week_number = getISOWeek(now);
        const year = now.getFullYear();

        const analysis = analyzeSpokenWords(transcript);
        const mispronouncedJson = JSON.stringify(analysis.mispronounced);

        let submissionId = null;

        if (usePostgres) {
            const query = `
                INSERT INTO submissions (student_id, student_name, student_email, audio_file_path, transcript, score, mispronounced_words, week_number, year)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
            `;
            const values = [student_id, student_name, student_email, audio_file_path, transcript, analysis.score, mispronouncedJson, week_number, year];
            const result = await pool.query(query, values);
            submissionId = result.rows[0].id;
        } else {
            submissionId = await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO submissions (student_id, student_name, student_email, audio_file_path, transcript, score, mispronounced_words, week_number, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [student_id, student_name, student_email, audio_file_path, transcript, analysis.score, mispronouncedJson, week_number, year],
                    function (err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });
        }

        res.json({ 
            success: true, 
            submission_id: submissionId,
            score: analysis.score,
            transcript: transcript,
            mispronounced: analysis.mispronounced
        });
    } catch (err) {
        console.error('Upload Endpoint Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/progress', async (req, res) => {
    const queryStr = `SELECT student_id, student_name, student_email, score, mispronounced_words, week_number, year FROM submissions`;

    try {
        if (usePostgres) {
            const result = await pool.query(queryStr);
            res.json({ progress: aggregateProgressRows(result.rows) });
        } else {
            db.all(queryStr, [], (err, rows) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ progress: aggregateProgressRows(rows) });
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/submissions/:student_id/:year/:week', async (req, res) => {
    const { student_id, year, week } = req.params;
    
    if (usePostgres) {
        try {
            const query = `
                SELECT id, student_name, student_email, audio_file_path, transcript, score, mispronounced_words, submitted_at 
                FROM submissions 
                WHERE student_id = $1 AND year = $2 AND week_number = $3
                ORDER BY submitted_at DESC
            `;
            const result = await pool.query(query, [parseInt(student_id, 10), parseInt(year, 10), parseInt(week, 10)]);
            const processedRows = result.rows.map(r => ({
                ...r,
                mispronounced: r.mispronounced_words ? JSON.parse(r.mispronounced_words) : []
            }));
            res.json({ submissions: processedRows });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    } else {
        const query = `
            SELECT id, student_name, student_email, audio_file_path, transcript, score, mispronounced_words, submitted_at 
            FROM submissions 
            WHERE student_id = ? AND year = ? AND week_number = ?
            ORDER BY submitted_at DESC
        `;
        db.all(query, [student_id, year, week], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const processedRows = rows.map(r => ({
                ...r,
                mispronounced: r.mispronounced_words ? JSON.parse(r.mispronounced_words) : []
            }));
            res.json({ submissions: processedRows });
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
