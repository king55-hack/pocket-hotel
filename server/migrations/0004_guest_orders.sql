-- Guests order food from their room by scanning a QR code.
-- qr_epoch: the owner can make all printed QR codes stop working by raising it (for example after a code leaks).
ALTER TABLE hotels ADD COLUMN qr_epoch INTEGER NOT NULL DEFAULT 0;

-- Photos of menu items. Small JPEGs (the app shrinks them first), kept as base64 text.
CREATE TABLE menu_photos (
  hotel_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hotel_id, id)
);
