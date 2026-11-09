const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

// Initialize SQLite database
const db = new sqlite3.Database('./read_aloud.db');

// Database schema including student_name
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        student_name TEXT NOT NULL DEFAULT 'Unknown',
        audio_file_path TEXT NOT NULL,
        score INTEGER DEFAULT 0,
        week_number INTEGER NOT NULL,
        year INTEGER NOT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Configure upload storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `audio-${req.body.student_id}-${uniqueSuffix}.webm`);
    }
});
const upload = multer({ storage });

// Express Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper: Calculate ISO Week Number
function getISOWeek(date = new Date()) {
    const tmpDate = new Date(date.getTime());
    tmpDate.setHours(0, 0, 0, 0);
    tmpDate.setDate(tmpDate.getDate() + 3 - (tmpDate.getDay() + 6) % 7);
    const week1 = new Date(tmpDate.getFullYear(), 0, 4);
    return 1 + Math.round(((tmpDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// Simulated Speech Assessment Algorithm
function calculateSpeechScore(fileSize) {
    const baseScore = 70;
    const variation = Math.floor(Math.random() * 25);
    return Math.min(100, baseScore + variation);
}

// API: Handle Audio Upload, Student Name & Instant Scoring
app.post('/api/upload', upload.single('audio'), (req, res) => {
    const { student_id, student_name } = req.body;
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file received' });
    }

    const audio_file_path = req.file.path.replace(/\\/g, '/');
    const now = new Date();
    const week_number = getISOWeek(now);
    const year = now.getFullYear();
    const nameToSave = student_name && student_name.trim() !== '' ? student_name.trim() : 'Unknown';
    
    const score = calculateSpeechScore(req.file.size);

    db.run(
        `INSERT INTO submissions (student_id, student_name, audio_file_path, score, week_number, year) VALUES (?, ?, ?, ?, ?, ?)`,
        [student_id, nameToSave, audio_file_path, score, week_number, year],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ 
                success: true, 
                submission_id: this.lastID,
                score: score 
            });
        }
    );
});

// API: Retrieve Progress & Names Across All Weeks
app.get('/api/progress', (req, res) => {
    const query = `
        SELECT 
            student_id,
            MAX(student_name) AS student_name,
            week_number,
            year,
            COUNT(id) AS weekly_count,
            ROUND(AVG(score), 1) AS avg_score,
            CASE WHEN COUNT(id) >= 4 THEN 'Completed' ELSE 'Pending' END AS status
        FROM submissions
        GROUP BY student_id, year, week_number
        ORDER BY year DESC, week_number DESC, student_id ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ progress: rows });
    });
});

// API: Retrieve All Audio Submissions per Student
app.get('/api/submissions/:student_id/:year/:week', (req, res) => {
    const { student_id, year, week } = req.params;
    const query = `
        SELECT id, student_name, audio_file_path, score, submitted_at 
        FROM submissions 
        WHERE student_id = ? AND year = ? AND week_number = ?
        ORDER BY submitted_at DESC
    `;
    db.all(query, [student_id, year, week], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ submissions: rows });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
