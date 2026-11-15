const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "rewards.db");

// Only these files are served. Everything else in this directory (the SQLite
// database, server source, package files) must never be reachable over HTTP.
const PUBLIC_FILES = ["index.html", "app.js", "styles.css"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SITES = 100;
const MAX_SITE_NAME = 100;
const MAX_NOTE = 2000;

function openDb(dbPath) {
  const db = new Database(dbPath);
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
  // xp: end-of-day pullbox XP total for that date. Added after the table
  // shipped, so migrate in place; nullable because most historical rows
  // predate XP tracking and "no reading" must stay distinct from 0.
  const hasXp = db.prepare("PRAGMA table_info(rewards)").all().some((c) => c.name === "xp");
  if (!hasXp) db.exec("ALTER TABLE rewards ADD COLUMN xp INTEGER");
  return db;
}

function getIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
}

// null/undefined/""/booleans must stay "no reading" — Number(null) is 0,
// which would silently record a real XP total of zero and wreck every
// gain computed against it.
function toXp(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// Returns { sites, note, xp } with only positive finite amounts and a string note,
// or null if the input is not an object.
function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rawSites = entry.sites;
  const sites = {};
  if (rawSites && typeof rawSites === "object" && !Array.isArray(rawSites)) {
    for (const [site, value] of Object.entries(rawSites).slice(0, MAX_SITES)) {
      const name = String(site).trim().slice(0, MAX_SITE_NAME);
      const amount = Number(value);
      if (name && Number.isFinite(amount) && amount > 0) sites[name] = amount;
    }
  }
  const note = typeof entry.note === "string" ? entry.note.trim().slice(0, MAX_NOTE) : "";
  return { sites, note, xp: toXp(entry.xp) };
}

function isEmpty(entry) {
  return Object.keys(entry.sites).length === 0 && !entry.note && entry.xp === null;
}

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
  for (const file of PUBLIC_FILES) {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
  }

  const selectAll = db.prepare("SELECT date, sites, note, xp FROM rewards WHERE ip = ?");
  const upsert = db.prepare(`
    INSERT INTO rewards (ip, date, sites, note, xp)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ip, date) DO UPDATE SET
      sites = excluded.sites,
      note  = excluded.note,
      -- Keep a previously recorded XP total if this write doesn't carry
      -- one, so a plain sites-only PUT can't erase the day's reading.
      xp    = COALESCE(excluded.xp, rewards.xp)
  `);
  const deleteOne = db.prepare("DELETE FROM rewards WHERE ip = ? AND date = ?");
  const deleteAll = db.prepare("DELETE FROM rewards WHERE ip = ?");

  app.get("/api/rewards", (req, res) => {
    const data = {};
    for (const row of selectAll.all(getIp(req))) {
      data[row.date] = { sites: JSON.parse(row.sites), note: row.note, xp: row.xp ?? null };
    }
    res.json(data);
  });

  app.put("/api/rewards/:date", (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (!req.body?.sites || typeof req.body.sites !== "object" || Array.isArray(req.body.sites)) {
      return res.status(400).json({ error: "sites must be an object" });
    }
    const entry = sanitizeEntry(req.body);
    if (isEmpty(entry)) {
      deleteOne.run(getIp(req), date);
    } else {
      upsert.run(getIp(req), date, JSON.stringify(entry.sites), entry.note, entry.xp);
    }
    res.json({ ok: true });
  });

  app.delete("/api/rewards/:date", (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    deleteOne.run(getIp(req), date);
    res.json({ ok: true });
  });

  app.put("/api/rewards", (req, res) => {
    const data = req.body;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "Body must be an object" });
    }
    const ip = getIp(req);
    db.transaction(() => {
      deleteAll.run(ip);
      for (const [date, raw] of Object.entries(data)) {
        if (!DATE_RE.test(date)) continue;
        const entry = sanitizeEntry(raw);
        if (!entry || isEmpty(entry)) continue;
        upsert.run(ip, date, JSON.stringify(entry.sites), entry.note, entry.xp);
      }
    })();
    res.json({ ok: true });
  });

  return app;
}

if (require.main === module) {
  createApp(openDb(DB_PATH)).listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = { createApp, openDb };
