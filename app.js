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

const DAY_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEY = "daily-rewards-data";
const TIMERS_KEY = "reward-timers";
const API_URL = "api/rewards";

const state = {
  viewYear: null,
  viewMonth: null,
  data: {},
  editingDate: null,
  timers: [],
  serverAvailable: false,
};

// ---------- Storage (API with localStorage fallback) ----------

function loadLocal() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
  } catch { return {}; }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function loadData() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (res.ok && isJson) {
      state.data = normalizeData(await res.json());
      state.serverAvailable = true;
      return;
    }
  } catch {
    // No backend (static hosting or file://) — use this browser's storage.
  }
  state.serverAvailable = false;
  state.data = loadLocal();
}

async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
}

// Persists one day. Throws if the save did not succeed.
async function saveEntry(dateKey, entry) {
  if (!state.serverAvailable) return saveLocal();
  const url = `${API_URL}/${dateKey}`;
  if (!entry) return request(url, { method: "DELETE" });
  return request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

// Replaces all data. Throws if the save did not succeed.
async function bulkSave(data) {
  if (!state.serverAvailable) return saveLocal();
  return request(API_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// Updates one day in memory and persists it, rolling back if the save fails.
async function commitEntry(key, entry) {
  const previous = state.data[key];
  setEntry(key, entry);
  try {
    await saveEntry(key, entry);
  } catch (err) {
    setEntry(key, previous);
    throw err;
  }
}

function setEntry(key, entry) {
  if (entry) state.data[key] = entry;
  else delete state.data[key];
}

function renderStorageStatus() {
  document.getElementById("storageStatus").textContent = state.serverAvailable
    ? "Saved to the server"
    : "Saved in this browser only — export to back up";
}

// ---------- Timer Storage (localStorage for timer config) ----------

function loadTimers() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMERS_KEY));
    if (Array.isArray(saved)) {
      state.timers = saved.filter(t => t && typeof t.name === "string").map(normalizeTimer);
      return;
    }
  } catch {}
  state.timers = DEFAULT_TIMERS.map(normalizeTimer);
}

function saveTimers() {
  try {
    localStorage.setItem(TIMERS_KEY, JSON.stringify(state.timers));
  } catch (err) {
    console.error("Could not save timers", err);
  }
}

function normalizeTimer(t) {
  const resetDay = Number(t.resetDay);
  return {
    name: t.name,
    cycle: t.cycle === "weekly" ? "weekly" : "daily",
    resetTime: /^\d{2}:\d{2}$/.test(t.resetTime) ? t.resetTime : "00:00",
    resetDay: Number.isInteger(resetDay) && resetDay >= 0 && resetDay <= 6 ? resetDay : 0,
    lastClaimed: Number(t.lastClaimed) || null,
  };
}

// ---------- Helpers ----------

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayKey() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = DAY_NAMES[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
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

// Keeps only well-formed days: YYYY-MM-DD keys, positive numeric amounts, string notes.
function normalizeData(raw) {
  const data = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return data;
  for (const [key, entry] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !entry || typeof entry !== "object") continue;
    const sites = {};
    if (entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)) {
      for (const [site, value] of Object.entries(entry.sites)) {
        const amount = Number(value);
        if (Number.isFinite(amount) && amount > 0) sites[site] = amount;
      }
    }
    const note = typeof entry.note === "string" ? entry.note : "";
    if (Object.keys(sites).length > 0 || note) data[key] = { sites, note };
  }
  return data;
}

// ---------- Timer Logic ----------

function getNextReset(timer, now = new Date()) {
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

function cycleMs(timer) {
  return timer.cycle === "weekly" ? 7 * DAY_MS : DAY_MS;
}

// Claimed means marked claimed at some point after the most recent reset.
function isClaimed(timer, now = new Date()) {
  const lastReset = getNextReset(timer, now).getTime() - cycleMs(timer);
  return timer.lastClaimed != null && timer.lastClaimed >= lastReset;
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
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

function resetLabel(timer, nextReset) {
  const utc = timer.cycle === "weekly"
    ? `Resets ${DAY_NAMES[timer.resetDay]} ${timer.resetTime} UTC`
    : `Resets daily ${timer.resetTime} UTC`;
  if (nextReset.getTimezoneOffset() === 0) return utc;
  const local = nextReset.toLocaleString([], timer.cycle === "weekly"
    ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
  return `${utc} · ${local} local`;
}

const baseTitle = document.title;
let timerViews = [];

function renderTimers() {
  const container = document.getElementById("timerCards");
  container.innerHTML = "";
  timerViews = [];

  if (state.timers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timer-empty";
    empty.textContent = "No timers configured. Click Edit to add some.";
    container.appendChild(empty);
    tickTimers();
    return;
  }

  for (const timer of state.timers) {
    const card = document.createElement("div");
    card.className = "timer-card";

    const top = document.createElement("div");
    top.className = "timer-top";
    const nameEl = document.createElement("div");
    nameEl.className = "timer-name";
    const dot = document.createElement("span");
    dot.className = "timer-dot";
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(timer.name));

    const claimBtn = document.createElement("button");
    claimBtn.type = "button";
    claimBtn.className = "timer-claim";
    claimBtn.addEventListener("click", () => toggleClaimed(timer));
    top.append(nameEl, claimBtn);

    const countdown = document.createElement("div");
    countdown.className = "timer-countdown";

    const label = document.createElement("div");
    label.className = "timer-label";

    card.append(top, countdown, label);
    container.appendChild(card);
    timerViews.push({ timer, card, claimBtn, countdown, label });
  }

  tickTimers();
}

// Updates the existing timer cards in place, so buttons keep focus and clicks land.
function tickTimers() {
  const now = new Date();
  let readyCount = 0;

  for (const { timer, card, claimBtn, countdown, label } of timerViews) {
    const nextReset = getNextReset(timer, now);
    const claimed = isClaimed(timer, now);
    if (!claimed) readyCount++;

    card.classList.toggle("ready", !claimed);
    card.classList.toggle("claimed", claimed);
    countdown.textContent = formatCountdown(nextReset - now);
    countdown.title = claimed ? "Until the next reward" : "Left to claim before reset";
    label.textContent = resetLabel(timer, nextReset);

    const text = claimed ? "Claimed ✓" : "Mark claimed";
    if (claimBtn.textContent !== text) claimBtn.textContent = text;
    claimBtn.title = claimed ? "Undo" : "Mark this reward as claimed";
    claimBtn.setAttribute("aria-pressed", String(claimed));
  }

  document.title = readyCount > 0 ? `(${readyCount}) ${baseTitle}` : baseTitle;
}

function toggleClaimed(timer) {
  timer.lastClaimed = isClaimed(timer) ? null : Date.now();
  saveTimers();
  tickTimers();
}

// ---------- Timer Modal ----------

function openTimerModal() {
  const container = document.getElementById("timerFields");
  container.innerHTML = "";

  for (const timer of state.timers) {
    container.appendChild(buildTimerRow(timer));
  }

  document.getElementById("newTimerName").value = "";
  showModal("timerModal");
}

function closeTimerModal() {
  hideModal("timerModal");
}

function buildTimerRow(timer) {
  const row = document.createElement("div");
  row.className = "timer-row";

  const label = document.createElement("label");
  label.textContent = timer.name;

  const cycleSelect = document.createElement("select");
  cycleSelect.dataset.field = "cycle";
  cycleSelect.setAttribute("aria-label", `${timer.name} reset cycle`);
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
  timeInput.setAttribute("aria-label", `${timer.name} reset time (UTC)`);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-site";
  remove.textContent = "×";
  remove.title = "Remove timer";
  remove.setAttribute("aria-label", `Remove ${timer.name}`);
  remove.addEventListener("click", () => row.remove());

  row.append(label, cycleSelect, timeInput, remove);

  const daySelect = document.createElement("select");
  daySelect.dataset.field = "resetDay";
  daySelect.setAttribute("aria-label", `${timer.name} reset day`);
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

  const existing = document.querySelector(`#timerFields .timer-row[data-name="${CSS.escape(name)}"]`);
  if (existing) { input.value = ""; return; }

  const timer = { name, cycle: "daily", resetTime: "00:00", resetDay: 0 };
  document.getElementById("timerFields").appendChild(buildTimerRow(timer));
  input.value = "";
}

function saveTimerModal(e) {
  e.preventDefault();
  const previous = new Map(state.timers.map(t => [t.name, t]));
  const timers = [];
  document.querySelectorAll("#timerFields .timer-row").forEach(row => {
    const name = row.dataset.name;
    const cycle = row.querySelector("[data-field='cycle']").value;
    const resetTime = row.querySelector("[data-field='resetTime']").value || "00:00";
    const dayEl = row.querySelector("[data-field='resetDay']");
    const resetDay = dayEl ? parseInt(dayEl.value, 10) : 0;
    const old = previous.get(name);
    // A claim only carries over if the schedule it was made against is unchanged.
    const sameSchedule = old && old.cycle === cycle && old.resetTime === resetTime
      && (cycle === "daily" || old.resetDay === resetDay);
    timers.push({ name, cycle, resetTime, resetDay, lastClaimed: sameSchedule ? old.lastClaimed : null });
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
  let monthDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(viewYear, viewMonth, d);
    const entry = state.data[key];
    const total = dayTotal(entry);
    monthSum += total;
    if (total > 0) monthDays++;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day";
    if (key === today) {
      cell.classList.add("today");
      cell.setAttribute("aria-current", "date");
    }
    if (key > today) cell.classList.add("future");
    cell.dataset.date = key;
    cell.setAttribute("aria-label",
      `${MONTH_NAMES[viewMonth]} ${d}: ${total === 0 ? "no rewards" : fmtMoney(total)}`);

    if (entry) {
      cell.style.backgroundColor = scaleColor(total);
      cell.classList.add("colored");
    }

    const header = document.createElement("div");
    header.className = "day-header";
    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d;
    header.appendChild(num);
    if (entry?.note) {
      const noteMark = document.createElement("span");
      noteMark.className = "note-mark";
      noteMark.textContent = "✎";
      noteMark.title = entry.note;
      header.appendChild(noteMark);
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
      if (sites.length > 2) {
        const more = document.createElement("span");
        more.className = "site-pill";
        more.textContent = `+${sites.length - 2}`;
        cell.appendChild(more);
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
  document.getElementById("monthDays").textContent = monthDays;

  const grand = Object.values(state.data).reduce((s, e) => s + dayTotal(e), 0);
  document.getElementById("grandTotal").textContent = fmtMoney(grand);
}

// ---------- Modals ----------

let focusBeforeModal = null;

function showModal(id) {
  focusBeforeModal = document.activeElement;
  const modal = document.getElementById(id);
  modal.classList.remove("hidden");
  modal.querySelector("input, select, textarea")?.focus();
}

function hideModal(id) {
  const modal = document.getElementById(id);
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  // The calendar may have re-rendered, so fall back to the same day's new cell.
  const target = focusBeforeModal?.isConnected
    ? focusBeforeModal
    : document.querySelector(`.day[data-date="${focusBeforeModal?.dataset?.date}"]`);
  target?.focus();
  focusBeforeModal = null;
}

function openModal(key) {
  state.editingDate = key;
  const entry = state.data[key] || { sites: {}, note: "" };

  document.getElementById("modalTitle").textContent = formatDateKey(key);
  const container = document.getElementById("siteFields");
  container.innerHTML = "";

  const sites = new Set([...knownSites(), ...Object.keys(entry.sites || {})]);
  for (const site of sites) {
    container.appendChild(buildSiteRow(site, entry.sites?.[site] ?? ""));
  }

  document.getElementById("noteField").value = entry.note || "";
  document.getElementById("newSiteName").value = "";
  document.getElementById("deleteDay").hidden = !state.data[key];
  setFormError("");
  showModal("modal");
}

function buildSiteRow(site, value) {
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
  input.inputMode = "decimal";
  input.value = value === 0 ? "" : (value ?? "");
  input.dataset.site = site;
  input.setAttribute("aria-label", `${site} amount`);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-site";
  remove.textContent = "×";
  remove.title = "Remove row";
  remove.setAttribute("aria-label", `Remove ${site}`);
  remove.addEventListener("click", () => row.remove());

  row.append(label, input, remove);
  return row;
}

function closeModal() {
  hideModal("modal");
  state.editingDate = null;
}

function setFormError(message) {
  const el = document.getElementById("formError");
  el.textContent = message;
  el.hidden = !message;
}

async function withSaving(action) {
  const buttons = document.querySelectorAll("#rewardForm button");
  buttons.forEach(b => { b.disabled = true; });
  setFormError("");
  try {
    await action();
    renderCalendar();
    closeModal();
  } catch (err) {
    console.error(err);
    setFormError(`Couldn't save (${err.message}). Please try again.`);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

async function saveModal(e) {
  e.preventDefault();
  const key = state.editingDate;
  if (!key) return;

  const sites = {};
  document.querySelectorAll("#siteFields .site-row").forEach(row => {
    const site = row.dataset.site;
    const input = row.querySelector("input[type=number]");
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) sites[site] = v;
  });
  const note = document.getElementById("noteField").value.trim();

  const entry = Object.keys(sites).length === 0 && !note ? null : { sites, note };
  await withSaving(() => commitEntry(key, entry));
}

function addSite() {
  const input = document.getElementById("newSiteName");
  const name = input.value.trim().toLowerCase();
  if (!name) return;
  const existing = document.querySelector(`#siteFields .site-row[data-site="${CSS.escape(name)}"]`);
  if (existing) {
    existing.querySelector("input").focus();
  } else {
    const row = buildSiteRow(name, "");
    document.getElementById("siteFields").appendChild(row);
    row.querySelector("input").focus();
  }
  input.value = "";
}

async function deleteDay() {
  const key = state.editingDate;
  if (!key) return;
  if (!confirm(`Clear all rewards for ${formatDateKey(key)}?`)) return;
  await withSaving(() => commitEntry(key, null));
}

// ---------- Import / Export ----------

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rewards-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let imported;
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
      imported = normalizeData(parsed);
      if (Object.keys(parsed).length > 0 && Object.keys(imported).length === 0) {
        throw new Error("no valid days found in the file");
      }
    } catch (e) {
      alert("Could not import: " + e.message);
      return;
    }

    const count = Object.keys(imported).length;
    if (!confirm(`Replace all existing data with ${count} imported day${count === 1 ? "" : "s"}?`)) return;

    const previous = state.data;
    state.data = imported;
    try {
      await bulkSave(imported);
    } catch (e) {
      state.data = previous;
      alert("Could not save the imported data: " + e.message);
    }
    renderCalendar();
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

// Pressing Enter in an "add" box should add the row, not submit the whole form.
function onEnter(id, handler) {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  loadTimers();
  goToday();
  renderTimers();
  renderStorageStatus();

  setInterval(tickTimers, 1000);

  document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));
  document.getElementById("todayBtn").addEventListener("click", goToday);

  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  document.getElementById("rewardForm").addEventListener("submit", saveModal);
  document.getElementById("addSiteBtn").addEventListener("click", addSite);
  onEnter("newSiteName", addSite);
  document.getElementById("deleteDay").addEventListener("click", deleteDay);

  document.getElementById("editTimersBtn").addEventListener("click", openTimerModal);
  document.getElementById("closeTimerModal").addEventListener("click", closeTimerModal);
  document.getElementById("timerModal").addEventListener("click", (e) => {
    if (e.target.id === "timerModal") closeTimerModal();
  });
  document.getElementById("timerForm").addEventListener("submit", saveTimerModal);
  document.getElementById("addTimerBtn").addEventListener("click", addTimer);
  onEnter("newTimerName", addTimer);

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
