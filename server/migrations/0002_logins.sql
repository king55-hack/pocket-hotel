-- Who signed in, from which device, and when (also wrong tries). Visible to the owner and to the admin.
CREATE TABLE login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id TEXT NOT NULL,
  user_id TEXT,
  who TEXT NOT NULL,            -- email (owner) or login name (staff), as typed
  kind TEXT NOT NULL,           -- owner | staff | signup
  ok INTEGER NOT NULL,
  reason TEXT,
  device_id TEXT,
  device_name TEXT,
  ip TEXT,                      -- shortened: the last part is dropped
  country TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX login_events_hotel ON login_events (hotel_id, at);
