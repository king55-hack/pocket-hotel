# Pocket Hotel API

Login (owner with email code, staff with hotel code + PIN), staff and roles, sync, admin tools, account closing.
Hono on Cloudflare Workers, data in D1 (SQLite).

## Run on your computer
    cd server && npm install
    cp .dev.vars.example .dev.vars      # local-only secrets; DEV_RETURN_OTP=1 returns the email code in the reply so you can test without email
    npm run db:local                    # creates the local database
    npm run dev                         # http://127.0.0.1:8790
    npm test                            # 36 tests, run in-process on a SQLite stand-in for D1

Never set `DEV_RETURN_OTP` to 1 on the live server.

## Put it online (only after the owner says yes; you run these yourself, nobody else needs the secrets)
    npx wrangler login
    npx wrangler d1 create pocket-hotel          # copy database_id into wrangler.toml
    npm run db:remote
    npx wrangler secret put JWT_SECRET           # a long random string (32+ characters)
    npx wrangler secret put ADMIN_KEY            # your private key for the admin page
    # email: Resend (RESEND_API_KEY + a verified MAIL_FROM) or Gmail (4 secrets, same steps as Pocket Pasal's server/README.md)
    # edit wrangler.toml: ALLOWED_ORIGINS = the web app address
    npm run deploy
Until an email provider is set, owner signup says "email is not set up" instead of pretending a code was sent.

## Who may do what
Rights are stored per person (`perms`), chosen by the owner, and checked by the server on every sync change by comparing it with what the server already has.
Roles only give a starting set. See `src/perms.ts` and `needed()` in `src/sync.ts`.

## Sync in short
Records (rooms, bookings, orders, hotel settings) are merged newest edit wins, record by record. Nothing is ever deleted.
Two phones booking the same room offline: both are kept, the server records a clash, the older booking keeps the room, and the manager moves the other one.
The same bill number on two phones is flagged the same way. Features (`feat`) are only changed by the admin.

## Admin
The web app has a page at `#/admin`; type the `ADMIN_KEY`. It lists hotels, switches features per hotel, and handles closing requests
(approve, then the hotel's server data is erased after 14 days by the daily job, or "Run due deletions now").
