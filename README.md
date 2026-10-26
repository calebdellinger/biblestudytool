# Margin

Your Bible study app. A quiet reader with your notes, highlights and cross-references one tap away, synced across your devices through your own PC.

## What's in this folder

| Folder | What it is |
| --- | --- |
| `app/` | The app itself (React + Vite, installable as a PWA). `app/dist/` is the ready-to-serve build. |
| `app/public/data/` | Bible text (BSB, KJV) and cross-references, built by `scripts/build_data.py`. |
| `server/` | What runs on your PC: the small web server, CouchDB setup, backups and restore. |
| `scripts/` | Data build script. |

## Set up your PC (one time, about 15 minutes)

1. **Install CouchDB.** Download the Windows installer from https://couchdb.apache.org/#download. Choose **Single node** and create an admin username and password.
2. **Install Tailscale** on this PC from https://tailscale.com/download and sign in.
3. **Turn on HTTPS for your Tailscale network.** Go to https://login.tailscale.com/admin/dns and turn on **MagicDNS** and **HTTPS Certificates**.
4. **Run the installer.** Open PowerShell **as administrator** in this folder, then run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\server\install.ps1
   ```

   It installs Node.js if needed, asks for your CouchDB login, your backup drive folder and a backup password, locks CouchDB down, starts the server, sets up nightly and weekly backups, and prints your app's address. Safe to run again any time.

## Set up each phone, tablet or laptop

1. Install Tailscale and sign in with the same account.
2. Open the address the installer printed (`https://<your-pc>.<tailnet>.ts.net:8443/`). On this PC that's https://beast.tailccf7aa.ts.net:8443/.
3. Add it to your home screen (iPhone: Share, then Add to Home Screen. Android: menu, then Install app).
4. In Margin, open **Settings** and enter your CouchDB username and password, then **Turn on sync**.

## How it works

- Every device keeps a **full copy** of your notes and highlights, so Margin works with no connection. Changes sync both ways whenever your PC is reachable over Tailscale.
- **CouchDB** on your PC holds the master copy. It listens only on the PC itself; your devices reach it through `server/server.mjs` (port 8787), which Tailscale publishes on HTTPS port 8443 to your devices only. Port 8080 and the plain address belong to your remote desktop (rdhost). Nothing is open to the internet.
- **Backups**: nightly at 2:30 am to your backup drive (last 60 kept), and weekly on Sunday at 3 am an encrypted copy to Google Drive (last 12 kept). Missed runs happen when the PC is next on.

## Restore from a backup

```powershell
cd server
node restore.mjs "E:\MarginBackups\margin-2026-10-19-02-30-00.json.gz"
```

This restores into a new database (`margin-restored-<date>`) so nothing is overwritten. Add `--into margin` to restore over the live one. Encrypted `.mrgn` files ask for your backup password. Test a restore every few months.

## Change the app

```powershell
cd app
npm install
npm run dev      # try changes at http://localhost:5173 (forwards /db to CouchDB on this PC)
npm run build    # rebuild app/dist; devices pick up the new version on their next visit
```

## Sources and licences

- Berean Standard Bible: public domain (CC0).
- King James Version: public domain.
- Cross-references: OpenBible.info, CC BY.
- Hebrew and Greek (interlinear, lexicons, grammar): STEPBible.org data from Tyndale House, Cambridge, CC BY 4.0. Rebuild with `python scripts/build_original.py <STEPBible-Data checkout>`.
- Spurgeon: sermons and the Treasury of David from lyteword/chspurgeon-sermons and lyteword/chspurgeon-tod (CC0); Morning and Evening from the `morning-evening` npm package (CCEL text). Rebuild with `node scripts/build_spurgeon.mjs <folder with both repos> <devotionals.json>`.
- Commentaries: Matthew Henry complete and concise (lyteword/mhenry-complete, mhenry-concise, CC0) via `node scripts/build_henry.mjs <folder>`; Barnes' Notes on the New Testament (CrossWire SWORD module, public domain) via `python scripts/build_sword_commentary.py <unzipped module> barnes data/raw/KJV.json`.
- Places: OpenBible.info Bible Geocoding Data (CC BY 4.0) via `python scripts/build_places.py <Bible-Geocoding-Data> <natural-earth geojson dir>`. Base map, modern borders and cities: Natural Earth (public domain; borders are de facto).
- People, family links, events and verse years: Theographic Bible Metadata (Robert Rouse, CC BY-SA 4.0) via `python scripts/build_people.py <theographic json dir>`; biographies from Easton's Bible Dictionary (1897, public domain). Scripture dates follow the traditional Ussher-style chronology. World events (`app/public/data/people/world.json`) are a hand-compiled list of approximate dates from standard histories.
- Daily reading: Robert Murray M'Cheyne's calendar (1842, public domain), list from mgyarmathy/bible-in-one-year (Unlicense); rebuild with `node scripts/build_plans.mjs`.
- Texts via [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).

## What's next

Phase 1 (this build): reader, Hebrew/Greek interlinear with word study, verse/chapter/book views, highlights, notes with automatic verse linking, cross-references, KJV comparison, search, sync and backups.
Phase 2 (this build): Spurgeon library: sermons by verse, Treasury of David, Morning and Evening, and search across all of it (runs on the PC). Phase 3: handwritten pages (needs an AI API key). See the spec doc for the full plan.

## Notifications (iPhone)

Margin sends its own Web Push notifications from your PC; no outside account or API key is involved.
On the PC the server makes its keys once (`server/push-keys.json`) and keeps subscribed devices in `server/push-subs.json`.
Set `"pushSubject": "https://<your-pc>.<tailnet>.ts.net:8443"` in `server/config.json` (Apple wants a real URL there).

On iPhone (iOS 16.4 or later): open Margin in Safari, Share › Add to Home Screen, open it from the Home Screen,
then Settings › Notifications › Turn on, and pick times. Reminders only go out while the PC is on; one missed while it slept
is still sent up to three hours late.

## Not in this repository

Passwords and keys (server/config.json, server/push-*.json, couchDb credentials.txt), database backups (server/BibleAppBackup/), builds (pp/dist/), update packages and old copies are never committed. The repository holds the app, the server, the build scripts and the generated reference data in pp/public/data/; some of that data comes from third-party sources, so keep this repository private.
