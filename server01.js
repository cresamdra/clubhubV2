const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("better-sqlite3");
const path = require("path");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static("frontend"));

if (!fs.existsSync("/app/data")) {
  fs.mkdirSync("/app/data");
}

const db = new sqlite3("/app/data/clubhub.db");
console.log("Connected to SQLite database.");

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

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
    res.json({ message: "User registered!", user: { id: result.lastInsertRowid, firstName, lastName, email, role: "member" } });
  } catch (err) {
    res.json({ error: "Email already exists or invalid data." });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare(`SELECT * FROM users WHERE email = ? AND password = ?`).get(username, password);
  if (!row) return res.json({ error: "Invalid email or password." });
  res.json({ user: row });
});

app.get("/api/members", (req, res) => {
  try {
    const rows = db.prepare(`SELECT id, firstName, lastName, email, role, status, joined FROM users ORDER BY joined DESC`).all();
    res.json({ members: rows });
  } catch (err) {
    res.json({ error: "Failed to fetch members." });
  }
});

app.patch("/api/members/:id", (req, res) => {
  const { id } = req.params;
  const { status, role } = req.body;
  const fields = [];
  const values = [];
  if (status !== undefined) { fields.push("status = ?"); values.push(status); }
  if (role   !== undefined) { fields.push("role = ?");   values.push(role);   }
  if (fields.length === 0) return res.json({ error: "Nothing to update." });
  values.push(id);
  try {
    const result = db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    if (result.changes === 0) return res.json({ error: "Member not found." });
    res.json({ message: "Member updated!" });
  } catch (err) {
    res.json({ error: "Failed to update member." });
  }
});

app.delete("/api/members/:id", (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    if (result.changes === 0) return res.json({ error: "Member not found." });
    res.json({ message: "Member deleted!" });
  } catch (err) {
    res.json({ error: "Failed to delete member." });
  }
});

app.get("/api/requests", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT r.*, u.firstName, u.lastName
      FROM requests r
      JOIN users u ON r.submittedBy = u.id
      ORDER BY r.ts DESC
    `).all();
    res.json({ requests: rows });
  } catch (err) {
    res.json({ error: "Failed to fetch requests." });
  }
});

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

app.delete("/api/requests/:id", (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare(`DELETE FROM requests WHERE id = ?`).run(id);
    if (result.changes === 0) return res.json({ error: "Request not found." });
    res.json({ message: "Request deleted!" });
  } catch (err) {
    res.json({ error: "Failed to delete request." });
  }
});

app.get("/api/reports", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT r.*, u.firstName, u.lastName
      FROM requests r
      JOIN users u ON r.submittedBy = u.id
      WHERE r.status = 'approved'
      ORDER BY r.ts DESC
    `).all();
    res.json({ reports: rows });
  } catch (err) {
    res.json({ error: "Failed to fetch reports." });
  }
});

app.get("/api/calendar", (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM calendar_events ORDER BY date ASC`).all();
    res.json({ events: rows });
  } catch (err) {
    res.json({ error: "Failed to fetch calendar events." });
  }
});

app.post("/api/calendar", (req, res) => {
  const { title, date, venue, time } = req.body;
  if (!title || !date) return res.json({ error: "Title and date are required." });
  const ts = Date.now();
  try {
    const result = db.prepare(
      `INSERT INTO calendar_events (title, date, venue, time, status, ts)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(title, date, venue || "", time || "", "approved", ts);
    res.json({ message: "Event added!", id: result.lastInsertRowid });
  } catch (err) {
    res.json({ error: "Failed to add event." });
  }
});

app.delete("/api/calendar/:id", (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(id);
    if (result.changes === 0) return res.json({ error: "Event not found." });
    res.json({ message: "Event deleted!" });
  } catch (err) {
    res.json({ error: "Failed to delete event." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});