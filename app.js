const DEFAULT_SITES = ["pullbox.gg", "hellcase.com"];

// Dollar value at which a day cell is considered "high" (fully red).
// Zero maps to blue, HIGH_THRESHOLD and above map to red, linearly in between.
const HIGH_THRESHOLD = 2;
const COLOR_LOW = [46, 92, 180];   // blue
const COLOR_HIGH = [200, 60, 60];  // red

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const state = {
  viewYear: null,
  viewMonth: null, // 0-11
  data: {},
  editingDate: null,
};

// ---------- Storage (API-backed) ----------

async function loadData() {
  try {
    const res = await fetch("/api/rewards");
    if (!res.ok) throw new Error(res.statusText);
    state.data = await res.json();
  } catch (e) {
    console.error("Failed to load data", e);
    state.data = {};
  }
}

async function saveEntry(dateKey, entry) {
  if (!entry || (Object.keys(entry.sites || {}).length === 0 && !entry.note)) {
    await fetch(`/api/rewards/${dateKey}`, { method: "DELETE" });
  } else {
    await fetch(`/api/rewards/${dateKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  }
}

async function bulkSave(data) {
  await fetch("/api/rewards", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
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

// ---------- Render ----------

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
    container.appendChild(buildSiteRow(site, entry.sites?.[site] ?? ""));
  }

  document.getElementById("noteField").value = entry.note || "";
  document.getElementById("newSiteName").value = "";
  document.getElementById("modal").classList.remove("hidden");
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
  input.value = value === 0 ? "" : (value ?? "");
  input.dataset.site = site;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-site";
  remove.textContent = "×";
  remove.title = "Remove row";
  remove.addEventListener("click", () => row.remove());

  row.append(label, input, remove);
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
  document.querySelectorAll("#siteFields .site-row").forEach(row => {
    const site = row.dataset.site;
    const input = row.querySelector("input[type=number]");
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) sites[site] = v;
  });
  const note = document.getElementById("noteField").value.trim();

  const entry = Object.keys(sites).length === 0 && !note ? null : { sites, note };
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
  if (document.querySelector(`#siteFields .site-row[data-site="${name}"]`)) {
    input.value = "";
    return;
  }
  document.getElementById("siteFields").appendChild(buildSiteRow(name, ""));
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
  goToday();

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
    if (e.key === "Escape") closeModal();
    if (document.getElementById("modal").classList.contains("hidden")) {
      if (e.key === "ArrowLeft") shiftMonth(-1);
      if (e.key === "ArrowRight") shiftMonth(1);
    }
  });
});
