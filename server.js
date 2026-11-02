const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

// Initialize SQLite database
const db = new sqlite3.Database('./read_aloud.db');

// Automatically create database tables on startup if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        audio_file_path TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        year INTEGER NOT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Upload directory configuration
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

// API Endpoint: Student Audio Upload
app.post('/api/upload', upload.single('audio'), (req, res) => {
    const { student_id } = req.body;
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file received' });
    }

    const audio_file_path = req.file.path;
    const now = new Date();
    const week_number = getISOWeek(now);
    const year = now.getFullYear();

    db.run(
        `INSERT INTO submissions (student_id, audio_file_path, week_number, year) VALUES (?, ?, ?, ?)`,
        [student_id, audio_file_path, week_number, year],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, submission_id: this.lastID });
        }
    );
});

// API Endpoint: Automated Weekly Progress Monitoring for Teachers
app.get('/api/progress', (req, res) => {
    const currentWeek = getISOWeek();
    const currentYear = new Date().getFullYear();

    const query = `
        SELECT 
            student_id,
            COUNT(id) AS weekly_count,
            CASE WHEN COUNT(id) >= 4 THEN 'Completed' ELSE 'Pending' END AS status
        FROM submissions
        WHERE week_number = ? AND year = ?
        GROUP BY student_id
    `;

    db.all(query, [currentWeek, currentYear], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ week: currentWeek, year: currentYear, progress: rows });
    });
});

// Dynamic Port Assignment for Render Deployment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
