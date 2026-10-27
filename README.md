# Pocket Hotel

Hotel app for small hotels, lodges and guest houses in Nepal. Works without internet, installs like an app on Android and on a computer (PWA). Nepali and English.

> All rights reserved. This repository is public so the work can be read and checked. It is not licensed for reuse or resale.

## Status (step 1)
Works on one device only. Data is saved in the browser on that device (IndexedDB). There is no server, login, staff roles or sync yet.

Done: room chart, booking with double-booking check, check-in, restaurant orders (kitchen screen, add to room bill), bill with VAT/service-charge switches, split payment, sequential bill numbers, housekeeping list, day money list, CSV export, settings (hotel info, rooms, prices, booking sources), activity log, per-hotel feature switches (test page).
Not done: staff and roles, server and sync, real admin page, BS dates, PDF/WhatsApp bill, kitchen printing, reports, day-end closing, email.

## Run
```bash
cd app && npm install && npm run dev      # http://localhost:5173
npm test                                  # unit + database tests
npm run build && npx vite preview         # installable build
```
Docs: `docs/research.md`, clickable mockup `docs/mockup/index.html`.
