const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp, openDb } = require("../server");

let server;
let base;

before(async () => {
  server = createApp(openDb(":memory:")).listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function put(path, body) {
  return fetch(base + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("serves the front-end files", async () => {
  for (const path of ["/", "/index.html", "/app.js", "/styles.css"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
  }
});

test("does not expose the database or server files", async () => {
  for (const path of ["/rewards.db", "/server.js", "/package.json", "/Dockerfile", "/.git/config"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
  }
});

test("saves, reads and deletes a day", async () => {
  let res = await put("/api/rewards/2026-01-02", { sites: { "pullbox.gg": 0.5 }, note: "hi" });
  assert.equal(res.status, 200);

  res = await fetch(`${base}/api/rewards`);
  assert.deepEqual((await res.json())["2026-01-02"], { sites: { "pullbox.gg": 0.5 }, note: "hi", xp: null });

  res = await fetch(`${base}/api/rewards/2026-01-02`, { method: "DELETE" });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/rewards`);
  assert.equal((await res.json())["2026-01-02"], undefined);
});

test("drops invalid amounts and non-string notes", async () => {
  await put("/api/rewards/2026-01-03", {
    sites: { good: 1.25, text: "lol", nested: { a: 1 }, negative: -1, zero: 0 },
    note: 123,
  });
  const data = await (await fetch(`${base}/api/rewards`)).json();
  assert.deepEqual(data["2026-01-03"], { sites: { good: 1.25 }, note: "", xp: null });
});

test("rejects malformed dates", async () => {
  assert.equal((await put("/api/rewards/not-a-date", { sites: {} })).status, 400);
  assert.equal((await fetch(`${base}/api/rewards/nope`, { method: "DELETE" })).status, 400);
});

test("bulk import replaces everything and skips bad entries", async () => {
  await put("/api/rewards/2026-01-04", { sites: { a: 1 } });
  const res = await put("/api/rewards", {
    "2026-02-01": { sites: { b: 2 }, note: "" },
    "2026-02-02": { sites: {}, note: "" },
    "garbage": { sites: { c: 3 } },
  });
  assert.equal(res.status, 200);
  const data = await (await fetch(`${base}/api/rewards`)).json();
  assert.deepEqual(data, { "2026-02-01": { sites: { b: 2 }, note: "", xp: null } });
});

test("stores an xp total and keeps it when a later write omits xp", async () => {
  await put("/api/rewards/2026-03-01", { sites: { "pullbox.gg": 1 }, xp: 30875 });
  let data = await (await fetch(`${base}/api/rewards`)).json();
  assert.equal(data["2026-03-01"].xp, 30875);

  // hellcase writes the same day without an xp reading; it must not wipe it
  await put("/api/rewards/2026-03-01", { sites: { "hellcase.com": 0.04 } });
  data = await (await fetch(`${base}/api/rewards`)).json();
  assert.equal(data["2026-03-01"].xp, 30875, "xp survived a sites-only write");
});

test("rejects nonsense xp values but keeps a day that is xp-only", async () => {
  await put("/api/rewards/2026-03-02", { sites: {}, xp: "lots" });
  let data = await (await fetch(`${base}/api/rewards`)).json();
  assert.equal(data["2026-03-02"], undefined, "no sites and no valid xp => not stored");

  await put("/api/rewards/2026-03-03", { sites: {}, xp: -5 });
  data = await (await fetch(`${base}/api/rewards`)).json();
  assert.equal(data["2026-03-03"], undefined, "negative xp rejected");

  await put("/api/rewards/2026-03-04", { sites: {}, xp: 1234.6 });
  data = await (await fetch(`${base}/api/rewards`)).json();
  assert.deepEqual(data["2026-03-04"], { sites: {}, note: "", xp: 1235 }, "xp-only day kept, rounded");
});
