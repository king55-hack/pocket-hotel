# Pocket Hotel

Hotel app for small hotels, lodges and guest houses in Nepal. Works without internet, installs like an app on Android and on a computer (PWA). Nepali and English.

> All rights reserved. This repository is public so the work can be read and checked. It is not licensed for reuse or resale.

## Status (step 2)
Works offline on each device and syncs to a server when online. Owners sign in with an email code, staff with a hotel code and PIN. The owner decides each person's rights; the server enforces them.
An admin page (`#/admin`) switches features on and off per hotel and handles account closing.

Done: everything from step 1, plus sign in, staff and rights, devices, sync with conflict display (two phones booking one room), server log of cancels and price changes, admin page, account closing request.
Not done: live deployment (nothing is online yet), real email sending (needs your Gmail/Resend setup), BS dates, PDF/WhatsApp bill, kitchen printing, reports, day-end closing, a real-phone offline check of the installed app, iPad/iPhone size tests, the "Book here" link and calendar import.
Known limits: a person who can open a device's browser data can read what is stored there; bill numbers can repeat when two phones are offline (the server flags it); rights are enforced when changes reach the server, so a revoked or changed person can still edit on their own device until it syncs.

## Run
```bash
cd server && npm install && npm run db:local && npm run dev   # API on http://127.0.0.1:8790 (see server/README.md)
cd app && npm install && npm run dev      # http://localhost:5173
npm test                                  # unit + database tests
npm run build && npx vite preview         # installable build
```
Docs: `docs/research.md`, clickable mockup `docs/mockup/index.html`.
