const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "rewards.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS rewards (
    ip    TEXT    NOT NULL,
    date  TEXT    NOT NULL,
    sites TEXT    NOT NULL DEFAULT '{}',
    note  TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (ip, date)
  )
`);

app.use(express.json());
app.use(express.static(__dirname));

function getIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
}

app.get("/api/rewards", (req, res) => {
  const ip = getIp(req);
  const rows = db.prepare("SELECT date, sites, note FROM rewards WHERE ip = ?").all(ip);
  const data = {};
  for (const row of rows) {
    data[row.date] = { sites: JSON.parse(row.sites), note: row.note };
  }
  res.json(data);
});

app.put("/api/rewards/:date", (req, res) => {
  const ip = getIp(req);
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format" });
  }
  const { sites, note } = req.body;
  if (!sites || typeof sites !== "object" || Array.isArray(sites)) {
    return res.status(400).json({ error: "sites must be an object" });
  }

  db.prepare(`
    INSERT INTO rewards (ip, date, sites, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip, date) DO UPDATE SET sites = excluded.sites, note = excluded.note
  `).run(ip, date, JSON.stringify(sites), note || "");

  res.json({ ok: true });
});

app.delete("/api/rewards/:date", (req, res) => {
  const ip = getIp(req);
  const { date } = req.params;
  db.prepare("DELETE FROM rewards WHERE ip = ? AND date = ?").run(ip, date);
  res.json({ ok: true });
});

app.put("/api/rewards", (req, res) => {
  const ip = getIp(req);
  const data = req.body;
  if (typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "Body must be an object" });
  }

  const upsert = db.prepare(`
    INSERT INTO rewards (ip, date, sites, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip, date) DO UPDATE SET sites = excluded.sites, note = excluded.note
  `);
  const del = db.prepare("DELETE FROM rewards WHERE ip = ?");

  db.transaction(() => {
    del.run(ip);
    for (const [date, entry] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const sites = entry?.sites && typeof entry.sites === "object" ? entry.sites : {};
      const note = entry?.note || "";
      if (Object.keys(sites).length === 0 && !note) continue;
      upsert.run(ip, date, JSON.stringify(sites), note);
    }
  })();

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
