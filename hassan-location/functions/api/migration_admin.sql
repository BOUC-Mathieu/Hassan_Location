-- ═══════════════════════════════════════════════════════════════════
-- HASSAN LOCATION — migration_admin.sql
-- Ajoute la table nécessaire à l'administration du planning
-- (/planning-admin). N'ALTÈRE ni ne supprime aucune donnée existante ;
-- la table "reservations" n'est pas modifiée.
--
-- Appliquer sur la base distante :
--   wrangler d1 execute hassan-location-db --file=migration_admin.sql --remote
--
-- Appliquer en local (dev) :
--   wrangler d1 execute hassan-location-db --file=migration_admin.sql
-- ═══════════════════════════════════════════════════════════════════

-- Une ligne = une date bloquée manuellement par l'administrateur
-- (indépendamment de toute réservation Stripe). Granularité "un jour"
-- car l'admin bloque/débloque date par date, en un clic.
CREATE TABLE IF NOT EXISTS manual_blocks (
  date       TEXT PRIMARY KEY,   -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manual_blocks_date ON manual_blocks(date);
