const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./read_aloud.db');

// Create SQLite tables if they don't exist
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

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `audio-${req.body.student_id}-${uniqueSuffix}.webm`);
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

function getISOWeek(date = new Date()) {
    const tmpDate = new Date(date.getTime());
    tmpDate.setHours(0, 0, 0, 0);
    tmpDate.setDate(tmpDate.getDate() + 3 - (tmpDate.getDay() + 6) % 7);
    const week1 = new Date(tmpDate.getFullYear(), 0, 4);
    return 1 + Math.round(((tmpDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

app.post('/api/upload', upload.single('audio'), (req, res) => {
    const { student_id } = req.body;
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

app.get('/api/progress', (req, res) => {
    const currentWeek = getISOWeek();
    const currentYear = new Date().getFullYear();

    const query = `
        SELECT 
            s.id AS student_id,
            s.name,
            COUNT(sub.id) AS weekly_count,
            CASE WHEN COUNT(sub.id) >= 4 THEN 'Completed' ELSE 'Pending' END AS status
        FROM students s
        LEFT JOIN submissions sub 
            ON s.id = sub.student_id 
            AND sub.week_number = ? 
            AND sub.year = ?
        GROUP BY s.id
    `;

    db.all(query, [currentWeek, currentYear], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ week: currentWeek, year: currentYear, progress: rows });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
