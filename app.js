const DEFAULT_SITES = ["pullbox.gg", "hellcase.com"];

const HIGH_THRESHOLD = 2;
const COLOR_LOW = [46, 92, 180];
const COLOR_HIGH = [200, 60, 60];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_TIMERS = [
  { name: "pullbox.gg", cycle: "daily", resetTime: "00:00", resetDay: 0 },
  { name: "hellcase.com", cycle: "daily", resetTime: "00:00", resetDay: 0 },
  { name: "CS2 Weekly Drop", cycle: "weekly", resetTime: "00:00", resetDay: 3 },
];

const STORAGE_KEY = "daily-rewards-data";

const state = {
  viewYear: null,
  viewMonth: null,
  data: {},
  editingDate: null,
  timers: [],
  serverAvailable: false,
};

// ---------- Storage (API with localStorage fallback) ----------

async function detectServer() {
  try {
    const res = await fetch("/api/rewards", { method: "HEAD" });
    state.serverAvailable = res.ok;
  } catch {
    state.serverAvailable = false;
  }
}

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function loadData() {
  await detectServer();
  if (state.serverAvailable) {
    try {
      const res = await fetch("/api/rewards");
      if (!res.ok) throw new Error(res.statusText);
      state.data = await res.json();
      return;
    } catch (e) {
      console.error("Failed to load from server, falling back to localStorage", e);
    }
  }
  state.data = loadLocal();
}

async function saveEntry(dateKey, entry) {
  if (state.serverAvailable) {
    try {
      if (!entry || (Object.keys(entry.sites || {}).length === 0 && !entry.note)) {
        await fetch(`/api/rewards/${dateKey}`, { method: "DELETE" });
      } else {
        await fetch(`/api/rewards/${dateKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
      }
      return;
    } catch (e) {
      console.error("Server save failed, saving locally", e);
    }
  }
  saveLocal();
}

async function bulkSave(data) {
  if (state.serverAvailable) {
    try {
      await fetch("/api/rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return;
    } catch (e) {
      console.error("Server bulk save failed, saving locally", e);
    }
  }
  saveLocal();
}

// ---------- Timer Storage (localStorage for timer config) ----------

function loadTimers() {
  try {
    const saved = localStorage.getItem("reward-timers");
    if (saved) {
      state.timers = JSON.parse(saved);
      return;
    }
  } catch {}
  state.timers = JSON.parse(JSON.stringify(DEFAULT_TIMERS));
}

function saveTimers() {
  localStorage.setItem("reward-timers", JSON.stringify(state.timers));
}

// ---------- Helpers ----------

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayKey() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayTotal(entry) {
  if (!entry || !entry.sites) return 0;
  return Object.values(entry.sites).reduce((s, v) => s + (Number(v) || 0), 0);
}

function fmtMoney(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function scaleColor(total) {
  const t = Math.max(0, Math.min(1, total / HIGH_THRESHOLD));
  const r = Math.round(COLOR_LOW[0] + (COLOR_HIGH[0] - COLOR_LOW[0]) * t);
  const g = Math.round(COLOR_LOW[1] + (COLOR_HIGH[1] - COLOR_LOW[1]) * t);
  const b = Math.round(COLOR_LOW[2] + (COLOR_HIGH[2] - COLOR_LOW[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function knownSites() {
  const set = new Set(DEFAULT_SITES);
  for (const entry of Object.values(state.data)) {
    if (entry && entry.sites) {
      for (const site of Object.keys(entry.sites)) set.add(site);
    }
  }
  return Array.from(set);
}

// ---------- Timer Logic ----------

function getNextReset(timer) {
  const now = new Date();
  const [hours, minutes] = timer.resetTime.split(":").map(Number);

  if (timer.cycle === "daily") {
    const reset = new Date(now);
    reset.setUTCHours(hours, minutes, 0, 0);
    if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
    return reset;
  }

  // weekly: resetDay is 0=Sun .. 6=Sat
  const reset = new Date(now);
  reset.setUTCHours(hours, minutes, 0, 0);
  const currentDay = reset.getUTCDay();
  let daysUntil = (timer.resetDay - currentDay + 7) % 7;
  if (daysUntil === 0 && reset <= now) daysUntil = 7;
  reset.setUTCDate(reset.getUTCDate() + daysUntil);
  return reset;
}

function formatCountdown(ms) {
  if (ms <= 0) return "Ready!";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${pad(rh)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function renderTimers() {
  const container = document.getElementById("timerCards");
  container.innerHTML = "";

  if (state.timers.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">No timers configured. Click Edit to add some.</div>';
    return;
  }

  const now = Date.now();

  for (const timer of state.timers) {
    const nextReset = getNextReset(timer);
    const remaining = nextReset.getTime() - now;
    const isReady = remaining <= 0;

    const card = document.createElement("div");
    card.className = "timer-card" + (isReady ? " ready" : "");

    const nameEl = document.createElement("div");
    nameEl.className = "timer-name";
    const dot = document.createElement("span");
    dot.className = "timer-dot";
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(timer.name));
    card.appendChild(nameEl);

    const countdownEl = document.createElement("div");
    countdownEl.className = "timer-countdown";
    countdownEl.textContent = formatCountdown(remaining);
    card.appendChild(countdownEl);

    const labelEl = document.createElement("div");
    labelEl.className = "timer-label";
    labelEl.textContent = timer.cycle === "weekly"
      ? `Resets ${DAY_NAMES[timer.resetDay]} at ${timer.resetTime} UTC`
      : `Resets daily at ${timer.resetTime} UTC`;
    card.appendChild(labelEl);

    container.appendChild(card);
  }
}

// ---------- Timer Modal ----------

function openTimerModal() {
  const container = document.getElementById("timerFields");
  container.innerHTML = "";

  for (const timer of state.timers) {
    container.appendChild(buildTimerRow(timer));
  }

  document.getElementById("newTimerName").value = "";
  document.getElementById("timerModal").classList.remove("hidden");
}

function closeTimerModal() {
  document.getElementById("timerModal").classList.add("hidden");
}

function buildTimerRow(timer) {
  const row = document.createElement("div");
  row.className = "timer-row";

  const label = document.createElement("label");
  label.textContent = timer.name;

  const cycleSelect = document.createElement("select");
  cycleSelect.dataset.field = "cycle";
  for (const opt of ["daily", "weekly"]) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (timer.cycle === opt) o.selected = true;
    cycleSelect.appendChild(o);
  }

  cycleSelect.addEventListener("change", () => {
    const daySelect = row.querySelector("[data-field='resetDay']");
    if (daySelect) daySelect.style.display = cycleSelect.value === "weekly" ? "" : "none";
  });

  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.dataset.field = "resetTime";
  timeInput.value = timer.resetTime;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-site";
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());

  row.append(label, cycleSelect, timeInput, remove);

  const daySelect = document.createElement("select");
  daySelect.dataset.field = "resetDay";
  daySelect.style.display = timer.cycle === "weekly" ? "" : "none";
  daySelect.style.gridColumn = "2 / 4";
  for (let i = 0; i < 7; i++) {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = DAY_NAMES[i];
    if (timer.resetDay === i) o.selected = true;
    daySelect.appendChild(o);
  }
  row.appendChild(daySelect);

  row.dataset.name = timer.name;
  return row;
}

function addTimer() {
  const input = document.getElementById("newTimerName");
  const name = input.value.trim();
  if (!name) return;

  const existing = document.querySelector(`#timerFields .timer-row[data-name="${name}"]`);
  if (existing) { input.value = ""; return; }

  const timer = { name, cycle: "daily", resetTime: "00:00", resetDay: 0 };
  document.getElementById("timerFields").appendChild(buildTimerRow(timer));
  input.value = "";
}

function saveTimerModal(e) {
  e.preventDefault();
  const timers = [];
  document.querySelectorAll("#timerFields .timer-row").forEach(row => {
    const name = row.dataset.name;
    const cycle = row.querySelector("[data-field='cycle']").value;
    const resetTime = row.querySelector("[data-field='resetTime']").value || "00:00";
    const dayEl = row.querySelector("[data-field='resetDay']");
    const resetDay = dayEl ? parseInt(dayEl.value) : 0;
    timers.push({ name, cycle, resetTime, resetDay });
  });
  state.timers = timers;
  saveTimers();
  closeTimerModal();
  renderTimers();
}

// ---------- Render Calendar ----------

function renderCalendar() {
  const { viewYear, viewMonth } = state;
  document.getElementById("monthLabel").textContent =
    `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  const cal = document.getElementById("calendar");
  cal.innerHTML = "";

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = todayKey();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement("div");
    blank.className = "day empty";
    cal.appendChild(blank);
  }

  let monthSum = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(viewYear, viewMonth, d);
    const entry = state.data[key];
    const total = dayTotal(entry);
    monthSum += total;

    const cell = document.createElement("div");
    cell.className = "day";
    if (key === today) cell.classList.add("today");
    if (key > today) cell.classList.add("future");
    cell.dataset.date = key;

    const hasGold = entry && entry.goldWins && Object.values(entry.goldWins).some(Boolean);
    if (entry) {
      cell.style.backgroundColor = scaleColor(total);
      cell.classList.add("colored");
    }
    if (hasGold) cell.classList.add("gold");

    const header = document.createElement("div");
    header.className = "day-header";
    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d;
    header.appendChild(num);
    if (hasGold) {
      const star = document.createElement("span");
      star.className = "gold-star";
      star.textContent = "★";
      header.appendChild(star);
    }
    cell.appendChild(header);

    if (entry && entry.sites) {
      const sites = Object.entries(entry.sites).filter(([, v]) => Number(v) > 0);
      for (const [site] of sites.slice(0, 2)) {
        const pill = document.createElement("span");
        pill.className = "site-pill";
        pill.textContent = site.replace(/\.(gg|com|net|io)$/i, "");
        cell.appendChild(pill);
      }
    }

    const totalEl = document.createElement("div");
    totalEl.className = "day-total" + (total === 0 ? " zero" : "");
    totalEl.textContent = total === 0 ? "—" : fmtMoney(total);
    cell.appendChild(totalEl);

    cell.addEventListener("click", () => openModal(key));
    cal.appendChild(cell);
  }

  document.getElementById("monthTotal").textContent = fmtMoney(monthSum);

  const grand = Object.values(state.data).reduce((s, e) => s + dayTotal(e), 0);
  document.getElementById("grandTotal").textContent = fmtMoney(grand);
}

// ---------- Modal ----------

function openModal(key) {
  state.editingDate = key;
  const entry = state.data[key] || { sites: {}, note: "" };

  document.getElementById("modalTitle").textContent = `Rewards for ${key}`;
  const container = document.getElementById("siteFields");
  container.innerHTML = "";

  const sites = new Set([...knownSites(), ...Object.keys(entry.sites || {})]);
  for (const site of sites) {
    container.appendChild(buildSiteRow(site, entry.sites?.[site] ?? "", entry.goldWins?.[site]));
  }

  document.getElementById("noteField").value = entry.note || "";
  document.getElementById("newSiteName").value = "";
  document.getElementById("modal").classList.remove("hidden");
}

function buildSiteRow(site, value, isGold) {
  const row = document.createElement("div");
  row.className = "site-row";
  row.dataset.site = site;

  const label = document.createElement("label");
  label.textContent = site;

  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.0001";
  input.min = "0";
  input.placeholder = "0.00";
  input.value = value === 0 ? "" : (value ?? "");
  input.dataset.site = site;

  const gold = document.createElement("input");
  gold.type = "checkbox";
  gold.className = "gold-toggle";
  gold.title = "Won a gold";
  gold.checked = !!isGold;
  gold.dataset.site = site;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-site";
  remove.textContent = "×";
  remove.title = "Remove row";
  remove.addEventListener("click", () => row.remove());

  row.append(label, input, gold, remove);
  return row;
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  state.editingDate = null;
}

async function saveModal(e) {
  e.preventDefault();
  if (!state.editingDate) return;

  const sites = {};
  const goldWins = {};
  document.querySelectorAll("#siteFields .site-row").forEach(row => {
    const site = row.dataset.site;
    const input = row.querySelector("input[type=number]");
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) sites[site] = v;
    const goldCheck = row.querySelector(".gold-toggle");
    if (goldCheck && goldCheck.checked) goldWins[site] = true;
  });
  const note = document.getElementById("noteField").value.trim();
  const hasGold = Object.keys(goldWins).length > 0;

  const entry = Object.keys(sites).length === 0 && !note && !hasGold ? null : { sites, note, ...(hasGold ? { goldWins } : {}) };
  if (entry) {
    state.data[state.editingDate] = entry;
  } else {
    delete state.data[state.editingDate];
  }

  await saveEntry(state.editingDate, entry);
  closeModal();
  renderCalendar();
}

function addSite() {
  const input = document.getElementById("newSiteName");
  const name = input.value.trim().toLowerCase();
  if (!name) return;
  if (document.querySelector(`#siteFields .site-row[data-site="${CSS.escape(name)}"]`)) {
    input.value = "";
    return;
  }
  document.getElementById("siteFields").appendChild(buildSiteRow(name, "", false));
  input.value = "";
}

async function deleteDay() {
  if (!state.editingDate) return;
  if (!confirm(`Clear all rewards for ${state.editingDate}?`)) return;
  delete state.data[state.editingDate];
  await saveEntry(state.editingDate, null);
  closeModal();
  renderCalendar();
}

// ---------- Import / Export ----------

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rewards-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad format");
      if (!confirm("Replace all existing data with imported JSON?")) return;
      state.data = parsed;
      await bulkSave(parsed);
      renderCalendar();
    } catch (e) {
      alert("Could not import: " + e.message);
    }
  };
  reader.readAsText(file);
}

// ---------- Wiring ----------

function shiftMonth(delta) {
  let m = state.viewMonth + delta;
  let y = state.viewYear;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  state.viewMonth = m;
  state.viewYear = y;
  renderCalendar();
}

function goToday() {
  const d = new Date();
  state.viewYear = d.getFullYear();
  state.viewMonth = d.getMonth();
  renderCalendar();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  loadTimers();
  goToday();
  renderTimers();

  setInterval(renderTimers, 1000);

  document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));
  document.getElementById("todayBtn").addEventListener("click", goToday);

  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  document.getElementById("rewardForm").addEventListener("submit", saveModal);
  document.getElementById("addSiteBtn").addEventListener("click", addSite);
  document.getElementById("deleteDay").addEventListener("click", deleteDay);

  document.getElementById("editTimersBtn").addEventListener("click", openTimerModal);
  document.getElementById("closeTimerModal").addEventListener("click", closeTimerModal);
  document.getElementById("timerModal").addEventListener("click", (e) => {
    if (e.target.id === "timerModal") closeTimerModal();
  });
  document.getElementById("timerForm").addEventListener("submit", saveTimerModal);
  document.getElementById("addTimerBtn").addEventListener("click", addTimer);

  document.getElementById("exportBtn").addEventListener("click", exportJson);
  document.getElementById("importBtn").addEventListener("click", () =>
    document.getElementById("importFile").click()
  );
  document.getElementById("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importJson(f);
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!document.getElementById("timerModal").classList.contains("hidden")) {
        closeTimerModal();
      } else {
        closeModal();
      }
    }
    const anyModalOpen = !document.getElementById("modal").classList.contains("hidden")
      || !document.getElementById("timerModal").classList.contains("hidden");
    if (!anyModalOpen) {
      if (e.key === "ArrowLeft") shiftMonth(-1);
      if (e.key === "ArrowRight") shiftMonth(1);
    }
  });
});
