const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clubhub.db');

db.all("SELECT * FROM users", [], (err, rows) => {
  if (err) {
    console.error("Connection Failed:", err.message);
  } else {
    console.log("Users table data:");
    console.table(rows);
  }
  db.close();
});