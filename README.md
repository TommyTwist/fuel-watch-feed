# Fuel Watch feed

Daily data file (`fuel.json`) for the Macclesfield Fuel Watch Samsung TV app.
Updated each morning by the Fuel Watch scheduled task. Market data only: local forecourt prices,
UK averages, Brent crude, news drivers and the refuel verdict. No personal data.

Personal instrument panel, not financial advice.

## TV app (remote-managed)

The TV has a small loader installed once (`Fuel Watch` v2 package). On every start it fetches the app from
[`app/`](app/) on the `main` branch, keeps the last good copy on the TV, and falls back to the copy built into
the package if GitHub can't be reached. While running it re-checks `app/manifest.json` every 30 minutes and
reloads into a new version once the remote has been idle for 5 minutes.

- `app/app.html` – page markup
- `app/app.css` – styles (2016 Tizen 2.4 WebKit: no CSS variables, -webkit- flex prefixes)
- `app/app.js` – app logic (ES5 only)
- `app/manifest.json` – **bump `version` to roll out a change**; `config` holds the settings (feed URL, page
  rotation, idle pause, burn-in drift, overnight ambient hours, update-check interval)

Anything pushed to `main` under `app/` runs on the TV, so keep pushes to this repo trusted.
