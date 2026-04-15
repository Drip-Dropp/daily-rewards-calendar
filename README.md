# Daily Gambling Rewards Calendar

A tiny single-page app for tracking daily free rewards from sites like
**pullbox.gg** and **hellcase.com** in a calendar view.

## Usage

Just open `index.html` in a browser — no build step, no server required.

- Click any day to enter the value of rewards you claimed on each site.
- Add more sites on the fly (e.g. `csgoroll.com`, `key-drop.com`).
- Data is saved to your browser's `localStorage`.
- Use **Export JSON** / **Import JSON** to back up or move between browsers.

## Features

- Month calendar with per-day totals and monthly/all-time totals
- Per-site entries (starts with `pullbox.gg` and `hellcase.com`)
- Optional notes per day (e.g. what the box contained)
- Arrow keys to move between months; `Esc` closes the modal
- Dark theme, responsive layout
- All data stays local in your browser

## Files

- `index.html` — markup
- `styles.css` — styling
- `app.js` — logic and localStorage persistence
