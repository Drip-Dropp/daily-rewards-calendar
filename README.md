# Daily Gambling Rewards Calendar

A tiny single-page app for tracking daily free rewards from sites like
**pullbox.gg** and **hellcase.com** in a calendar view.

## Usage

There are two ways to run it. The page detects which one it's in and shows
where your data is saved at the bottom of the page.

### Static (no server)

Open `index.html` in a browser, or host the files on any static host such as
GitHub Pages. Data is saved in your browser's `localStorage`, so use
**Export JSON** regularly to back it up.

### With the server (SQLite)

```sh
npm install
npm start          # http://localhost:3000
```

Data is stored in a SQLite database on the server. Each visitor's data is
keyed by their IP address.

| Variable  | Default                | Purpose                     |
| --------- | ---------------------- | --------------------------- |
| `PORT`    | `3000`                 | Port to listen on           |
| `DB_PATH` | `./rewards.db`         | SQLite database file        |

### Docker

```sh
docker run -d -p 3000:3000 -v rewards-data:/data ghcr.io/drip-dropp/daily-rewards-calendar
```

In the image, the database lives at `/data/rewards.db`. Mount a volume on
`/data` to keep your data when the container is recreated.

## Features

- Month calendar with per-day totals, heatmap colouring, and monthly/all-time totals
- Per-site entries (starts with `pullbox.gg` and `hellcase.com`); add more sites on the fly
- Optional notes per day (e.g. what the box contained)
- Reset timers with countdowns to each site's next reset (UTC, with your local time shown)
- **Mark claimed** on each timer; it becomes ready again after the next reset, and
  the tab title shows how many rewards are still unclaimed
- Arrow keys to move between months; `Esc` closes dialogs; keyboard-accessible calendar
- Export / import JSON to back up or move between browsers
- Dark theme, responsive layout

## Development

```sh
npm test
```

## Files

- `index.html` — markup
- `styles.css` — styling
- `app.js` — front-end logic (talks to the API, or falls back to `localStorage`)
- `server.js` — Express + SQLite API and static file server
- `test/` — API tests (`node:test`)
