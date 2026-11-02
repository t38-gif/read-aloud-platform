const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

// 初始化 SQLite 数据库
const db = new sqlite3.Database('./read_aloud.db');

// 自动创建数据库表（如果不存在）
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

// 配置文件上传路径
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

// 中间件设置
app.use(express.json());
// 托管 public 文件夹内的静态页面 (index.html)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 计算当前 ISO 周数辅助函数
function getISOWeek(date = new Date()) {
    const tmpDate = new Date(date.getTime());
    tmpDate.setHours(0, 0, 0, 0);
    tmpDate.setDate(tmpDate.getDate() + 3 - (tmpDate.getDay() + 6) % 7);
    const week1 = new Date(tmpDate.getFullYear(), 0, 4);
    return 1 + Math.round(((tmpDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// API: 处理学生音频上传
app.post('/api/upload', upload.single('audio'), (req, res) => {
    const { student_id } = req.body;
    if (!req.file) {
        return res.status(400).json({ error: '没有接收到音频文件' });
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
// API: Get Progress Tracked Directly From Submissions
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
    `;

    db.all(query, [currentWeek, currentYear], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ week: currentWeek, year: currentYear, progress: rows });
    });
});

// 适配 Render 的动态端口设置
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
