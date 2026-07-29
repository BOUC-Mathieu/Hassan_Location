-- ═══════════════════════════════════════════════════════════════════
-- HASSAN LOCATION — schema.sql
-- Cloudflare D1 Database Schema
--
-- Créer la base de données :
--   wrangler d1 create hassan-location-db
--
-- Appliquer le schéma :
--   wrangler d1 execute hassan-location-db --file=schema.sql
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reservations (
  id                     TEXT PRIMARY KEY,
  stripe_session_id      TEXT UNIQUE NOT NULL,
  stripe_payment_intent  TEXT DEFAULT '',

  -- Dates de location (format YYYY-MM-DD)
  start_date             TEXT NOT NULL,
  end_date               TEXT NOT NULL,
  days                   INTEGER NOT NULL CHECK(days > 0),

  -- Heure de prise en charge souhaitée (format HH:MM, ex. "09:00").
  -- La restitution est prévue à la même heure, le jour de end_date.
  pickup_time            TEXT NOT NULL DEFAULT '09:00',

  -- Tarification (en euros entiers pour éviter les flottants)
  rate_per_day           INTEGER NOT NULL,
  total_amount           INTEGER NOT NULL,
  deposit_amount         INTEGER NOT NULL,
  payment_option         TEXT NOT NULL CHECK(payment_option IN ('deposit','full')),
  amount_paid            INTEGER NOT NULL,

  -- Statut de la réservation
  -- 'paid'      → paiement reçu, contrat en attente                (bloque le calendrier)
  -- 'validated' → contrat signé et validé par le propriétaire      (bloque le calendrier)
  -- 'cancelled' → annulé                                           (libère le calendrier)
  -- 'refunded'  → remboursé via Stripe                             (libère le calendrier)
  status                 TEXT NOT NULL DEFAULT 'paid'
                         CHECK(status IN ('paid','validated','cancelled','refunded')),

  client_email           TEXT DEFAULT '',
  notes                  TEXT DEFAULT '',   -- notes internes du propriétaire

  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index pour les requêtes de disponibilité (la plus fréquente)
CREATE INDEX IF NOT EXISTS idx_res_dates   ON reservations(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_res_status  ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_res_session ON reservations(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_res_intent  ON reservations(stripe_payment_intent);
