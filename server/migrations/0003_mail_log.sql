-- One row per bill emailed, so the daily limit per hotel can be enforced.
CREATE TABLE mail_log (
  hotel_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX mail_log_hotel ON mail_log (hotel_id, at);
