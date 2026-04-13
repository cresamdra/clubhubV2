const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static("frontend"));

const db = new sqlite3.Database("./clubhub.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT,
    lastName TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT,
    status TEXT,
    joined TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    date TEXT,
    venue TEXT,
    desc TEXT,
    submittedBy INTEGER,
    status TEXT,
    comment TEXT,
    ts INTEGER,
    FOREIGN KEY(submittedBy) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT,
    time TEXT,
    status TEXT DEFAULT 'approved',
    ts INTEGER
  )`);
});

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
  const sql = `INSERT INTO users (firstName,lastName,email,password,role,status,joined)
               VALUES (?,?,?,?,?,?,?)`;
  db.run(sql, [firstName, lastName, email, password, "member", "active", joined], function (err) {
    if (err) return res.json({ error: "Email already exists or invalid data." });
    res.json({
      message: "User registered!",
      user: { id: this.lastID, firstName, lastName, email, role: "member" },
    });
  });
});

// ── LOGIN ──────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const sql = `SELECT * FROM users WHERE email = ? AND password = ?`;
  db.get(sql, [username, password], (err, row) => {
    if (err) return res.json({ error: "Server error" });
    if (!row) return res.json({ error: "Invalid email or password." });
    res.json({ user: row });
  });
});

// ── GET ALL REQUESTS (with submitter name) ────────────────────────────────────
app.get("/api/requests", (req, res) => {
  const sql = `
    SELECT r.*, u.firstName, u.lastName
    FROM requests r
    JOIN users u ON r.submittedBy = u.id
    ORDER BY r.ts DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.json({ error: "Failed to fetch requests" });
    res.json({ requests: rows });
  });
});

// ── SUBMIT NEW REQUEST (member) ───────────────────────────────────────────────
app.post("/api/requests", (req, res) => {
  const { title, date, venue, desc, submittedBy } = req.body;
  if (!title || !date || !venue || !submittedBy)
    return res.json({ error: "Missing required fields." });

  const ts = Date.now();
  const sql = `INSERT INTO requests (title,date,venue,desc,submittedBy,status,ts)
               VALUES (?,?,?,?,?,?,?)`;
  db.run(sql, [title, date, venue, desc || "", submittedBy, "pending", ts], function (err) {
    if (err) return res.json({ error: "Failed to submit request" });
    res.json({ message: "Request submitted!", id: this.lastID });
  });
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

  const sql = `UPDATE requests SET ${fields.join(", ")} WHERE id = ?`;
  db.run(sql, values, function (err) {
    if (err) return res.json({ error: "Failed to update request." });
    if (this.changes === 0) return res.json({ error: "Request not found." });
    res.json({ message: "Request updated.", id: Number(id), status, comment: comment ?? "" });
  });
});

// ── DELETE REQUEST (admin) ────────────────────────────────────────────────────
app.delete("/api/requests/:id", (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM requests WHERE id = ?`, [id], function (err) {
    if (err) return res.json({ error: "Failed to delete request." });
    if (this.changes === 0) return res.json({ error: "Request not found." });
    res.json({ message: "Request deleted.", id: Number(id) });
  });
});

// ── GET ALL MEMBERS (admin) ───────────────────────────────────────────────────
app.get("/api/members", (req, res) => {
  const sql = `SELECT id, firstName, lastName, email, role, status, joined FROM users ORDER BY joined DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.json({ error: "Failed to fetch members." });
    res.json({ members: rows });
  });
});

// ── UPDATE MEMBER ROLE / STATUS (admin) ───────────────────────────────────────
app.patch("/api/members/:id", (req, res) => {
  const { id } = req.params;
  const { role, status } = req.body;

  if (!role && !status)
    return res.json({ error: "Provide at least role or status to update." });

  const fields = [];
  const values = [];
  if (role) {
    const allowedRoles = ["member", "admin"];
    if (!allowedRoles.includes(role)) return res.json({ error: "Invalid role." });
    fields.push("role = ?");
    values.push(role);
  }
  if (status) {
    const allowedStatus = ["active", "inactive", "blocked"];
    if (!allowedStatus.includes(status)) return res.json({ error: "Invalid status." });
    fields.push("status = ?");
    values.push(status);
  }
  values.push(id);

  const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
  db.run(sql, values, function (err) {
    if (err) return res.json({ error: "Failed to update member." });
    if (this.changes === 0) return res.json({ error: "Member not found." });
    res.json({ message: "Member updated.", id: Number(id) });
  });
});

// ── GET CALENDAR EVENTS ───────────────────────────────────────────────────────
app.get("/api/calendar", (req, res) => {
  const calSql = `SELECT id, title, date, venue, time, status FROM calendar_events ORDER BY date ASC`;
  const reqSql = `
    SELECT r.id, r.title, r.date, r.venue, '' AS time, r.status
    FROM requests r WHERE r.status = 'approved'
  `;

  db.all(calSql, [], (err, calRows) => {
    if (err) return res.json({ error: "Failed to fetch calendar events." });
    db.all(reqSql, [], (err2, reqRows) => {
      if (err2) return res.json({ error: "Failed to fetch approved requests." });
      const seen = new Set(calRows.map(e => `${e.title}|${e.date}`));
      const merged = [
        ...calRows,
        ...reqRows.filter(r => !seen.has(`${r.title}|${r.date}`)),
      ];
      res.json({ events: merged });
    });
  });
});

// ── ADD CALENDAR EVENT (admin) ────────────────────────────────────────────────
app.post("/api/calendar", (req, res) => {
  const { title, date, venue, time } = req.body;
  if (!title || !date) return res.json({ error: "Title and date are required." });

  const ts = Date.now();
  const sql = `INSERT INTO calendar_events (title, date, venue, time, status, ts) VALUES (?,?,?,?,?,?)`;
  db.run(sql, [title, date, venue || "", time || "", "approved", ts], function (err) {
    if (err) return res.json({ error: "Failed to add calendar event." });
    res.json({ message: "Event added!", id: this.lastID });
  });
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
app.get("/api/reports", (req, res) => {
  const results = {};

  // 1. Status breakdown
  const statusSql = `SELECT status, COUNT(*) as count FROM requests GROUP BY status`;

  // 2. Requests per month (last 6 months)
  const monthSql = `
    SELECT
      strftime('%Y-%m', datetime(ts/1000, 'unixepoch')) AS month,
      COUNT(*) AS count
    FROM requests
    WHERE ts IS NOT NULL
    GROUP BY month
    ORDER BY month ASC
    LIMIT 6
  `;

  // 3. Top venues
  const venueSql = `
    SELECT venue, COUNT(*) as count
    FROM requests
    WHERE venue != ''
    GROUP BY venue
    ORDER BY count DESC
    LIMIT 5
  `;

  // 4. Member activity (top submitters)
  const memberSql = `
    SELECT u.firstName || ' ' || u.lastName AS name, COUNT(r.id) AS count
    FROM users u
    LEFT JOIN requests r ON r.submittedBy = u.id
    WHERE u.role = 'member'
    GROUP BY u.id
    ORDER BY count DESC
    LIMIT 6
  `;

  // 5. Recent decisions
  const recentSql = `
    SELECT r.title, r.status, r.date, u.firstName || ' ' || u.lastName AS submittedBy
    FROM requests r
    JOIN users u ON r.submittedBy = u.id
    WHERE r.status IN ('approved','rejected','revision')
    ORDER BY r.ts DESC
    LIMIT 8
  `;

  // Run all queries in parallel-ish using a counter
  let done = 0;
  const total = 5;
  const finish = () => { done++; if (done === total) res.json(results); };

  db.all(statusSql, [], (err, rows) => {
    results.statusBreakdown = err ? [] : rows;
    finish();
  });
  db.all(monthSql, [], (err, rows) => {
    results.requestsPerMonth = err ? [] : rows;
    finish();
  });
  db.all(venueSql, [], (err, rows) => {
    results.topVenues = err ? [] : rows;
    finish();
  });
  db.all(memberSql, [], (err, rows) => {
    results.memberActivity = err ? [] : rows;
    finish();
  });
  db.all(recentSql, [], (err, rows) => {
    results.recentDecisions = err ? [] : rows;
    finish();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});