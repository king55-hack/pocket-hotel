CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,            -- short code staff type to find the hotel at login
  plan TEXT NOT NULL DEFAULT 'free',
  feat TEXT NOT NULL,                   -- JSON: features the admin switched on. Only the admin changes this.
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id),
  email TEXT UNIQUE,                    -- owner only
  username TEXT,                        -- staff login name, unique inside one hotel
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  perms TEXT NOT NULL,                  -- JSON list chosen by the owner
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,                   -- owner: password hash. staff: PIN hash.
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_username ON users (hotel_id, username);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX otps_email ON otps (email, created_at);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL, hash TEXT NOT NULL,
  expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE login_attempts (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX login_attempts_key ON login_attempts (key, at);

CREATE TABLE records (
  hotel_id TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL, seq INTEGER NOT NULL, device_id TEXT NOT NULL, uniq TEXT,
  PRIMARY KEY (hotel_id, tbl, id)
);
CREATE INDEX records_seq ON records (hotel_id, seq);
CREATE INDEX records_uniq ON records (hotel_id, tbl, uniq);

CREATE TABLE conflicts (
  id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL, kind TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL
);

-- What the server saw happen: staff changes, cancelled bookings, price changes, refused attempts.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id TEXT NOT NULL, at INTEGER NOT NULL, user_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX audit_hotel ON audit (hotel_id, at);

CREATE TABLE closure_requests (
  id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL, hotel_name TEXT NOT NULL, owner_email TEXT NOT NULL,
  reason_code TEXT NOT NULL, reason_text TEXT, status TEXT NOT NULL,
  requested_at INTEGER NOT NULL, decided_at INTEGER, decision_note TEXT, scheduled_at INTEGER, done_at INTEGER
);
CREATE INDEX closure_status ON closure_requests (status, scheduled_at);

CREATE TABLE admin_attempts (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX admin_attempts_key ON admin_attempts (key, at);
