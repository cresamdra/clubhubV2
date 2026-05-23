const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("better-sqlite3");
const path = require("path");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000; // FIX: use Render's port

app.use(bodyParser.json());
app.use(cors());
app.use(express.static("frontend"));

// FIX: ensure /data directory exists for Render persistent disk
if (!fs.existsSync("./data")) {
  fs.mkdirSync("./data");
}

// FIX: point DB to ./data/ so it survives on Render's persistent disk
const db = new sqlite3("./data/clubhub.db");
console.log("Connected to SQLite database.");

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT,
    lastName  TEXT,
    email     TEXT UNIQUE,
    password  TEXT,
    role      TEXT,
    status    TEXT,
    joined    TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT,
    date        TEXT,
    venue       TEXT,
    desc        TEXT,
    submittedBy INTEGER,
    status      TEXT,
    comment     TEXT,
    ts          INTEGER,
    FOREIGN KEY(submittedBy) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_events (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    title  TEXT NOT NULL,
    date   TEXT NOT NULL,
    venue  TEXT,
    time   TEXT,
    status TEXT DEFAULT 'approved',
    ts     INTEGER
  )
`);

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ── REGISTER ──────────────────────────────────────────────────────────────────
app.post("/api/register", (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password)
    return res.json({ error: "All fields are required." });

  const joined = new Date().toISOString().split("T")[0];
  const stmt = db.prepare(
    `INSERT INTO users (firstName, lastName, email, password, role, status, joined)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  try {
    const result = stmt.run(firstName, lastName, email, password, "member", "active", joined);
    res.json({
      message: "User registered!",
      user: { id: result.lastInsertRowid, firstName, lastName, email, role: "member" },
    });
  } catch (err) {
    res.json({ error: "Email already exists or invalid data." });
  }
});

// ── LOGIN ──────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare(`SELECT * FROM users WHERE email = ? AND password = ?`).get(username, password);
  if (!row) return res.json({ error: "Invalid email or password." });
  res.json({ user: row });
});

// ── GET ALL REQUESTS (with submitter name) ────────────────────────────────────
app.get("/api/requests", (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.firstName, u.lastName
    FROM requests r
    JOIN users u ON r.submittedBy = u.id
    ORDER BY r.ts DESC
  `).all();
  res.json({ requests: rows });
});

// ── SUBMIT NEW REQUEST (member) ───────────────────────────────────────────────
app.post("/api/requests", (req, res) => {
  const { title, date, venue, desc, submittedBy } = req.body;
  if (!title || !date || !venue || !submittedBy)
    return res.json({ error: "Missing required fields." });

  const ts = Date.now();
  try {
    const result = db.prepare(
      `INSERT INTO requests (title, date, venue, desc, submittedBy, status, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(title, date, venue, desc || "", submittedBy, "pending", ts);
    res.json({ message: "Request submitted!", id: result.lastInsertRowid });
  } catch (err) {
    res.json({ error: "Failed to submit request" });
  }
});

// ── UPDATE REQUEST ─────────────────────────────────────────────────────────────
app.patch("/api/requests/:id", (req, res) => {
  const { id } = req.params;
  const { status, comment, title, date, venue, desc } = req.body;

  const allowed = ["approved", "rejected", "revision", "pending"];
  if (!status || !allowed.includes(status))
    return res.json({ error: "Invalid status value." });

  const fields = ["status = ?", "comment = ?"];
  const values = [status, comment ?? ""];

  if (title !== undefined) { fields.push("title = ?"); values.push(title); }
  if (date  !== undefined) { fields.push("date = ?");  values.push(date);  }
  if (venue !== undefined) { fields.push("venue = ?"); values.push(venue); }
  if (desc  !== undefined) { fields.push("desc = ?");  values.push(desc);  }

  values.push(id);

  try {
    const result = db.prepare(`UPDATE requests SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    if (result.changes === 0) return res.json({ error: "Request not found." });
    res.json({ message: "Request updated!" });
  } catch (err) {
    res.json({ error: "Failed to update request." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX: removed browser auto-open (xdg-open/open/start) — not needed on server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});