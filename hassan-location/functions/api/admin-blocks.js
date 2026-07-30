/**
 * GET  /api/admin-blocks
 * POST /api/admin-blocks
 *
 * API protégée (Basic Auth, voir functions/_lib/auth.js) utilisée
 * uniquement par la page /planning-admin.
 *
 * GET  → { ok:true, reservations:[...], manualBlocks:["YYYY-MM-DD", ...] }
 *        reservations : status IN ('paid','validated') — mêmes lignes que
 *        celles utilisées par /api/availability (aucune nouvelle logique
 *        de disponibilité, on relit juste la table existante).
 *
 * POST body : { action: 'block-manual',      date }
 *             { action: 'unblock-manual',    date }
 *             { action: 'cancel-reservation', reservationId }
 *
 *   - 'block-manual'       : ajoute une date à manual_blocks (orange)
 *   - 'unblock-manual'     : retire une date de manual_blocks
 *   - 'cancel-reservation' : passe une réservation Stripe en 'cancelled'.
 *     ⚠️ Une réservation couvre une plage (start_date → end_date) ; il
 *     n'est pas possible de libérer un seul jour à l'intérieur d'une
 *     réservation Stripe sans casser les données de paiement. Cliquer sur
 *     n'importe quelle date rouge de cette réservation libère donc TOUTE
 *     la plage — c'est le comportement voulu en cas d'annulation client.
 */

import { checkAdminAuth } from '../_lib/auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const authFail = await checkAdminAuth(request, env);
  if (authFail) return authFail;

  if (!env.DB) {
    console.error('[admin-blocks] CONFIG MANQUANTE : binding D1 "DB" introuvable.');
    return Response.json({ ok: false, error: 'Erreur serveur' }, { status: 500, headers: JSON_HEADERS });
  }

  try {
    // ─── Réservations ────────────────────────────────────────────
    // Repli automatique si la colonne pickup_time n'a pas encore été
    // migrée sur la base distante (migration_pickup_time.sql non
    // exécutée) : sans ce repli, cette seule requête plante et bloque
    // TOUT le chargement de l'admin (calendrier + blocages manuels).
    let reservations;
    try {
      const { results } = await env.DB.prepare(`
        SELECT id, start_date, end_date, pickup_time, status, client_email, amount_paid, payment_option, created_at
        FROM   reservations
        WHERE  status IN ('paid', 'validated')
        ORDER  BY start_date ASC
      `).all();
      reservations = results;
    } catch (colErr) {
      if (!/no such column/i.test(colErr.message)) throw colErr;
      console.warn(
        '[admin-blocks] colonne "pickup_time" introuvable (migration_pickup_time.sql non appliquée ?) — ' +
        'repli sans cette colonne. Exécutez : wrangler d1 execute hassan-location-db --file=migration_pickup_time.sql --remote'
      );
      const { results } = await env.DB.prepare(`
        SELECT id, start_date, end_date, status, client_email, amount_paid, payment_option, created_at
        FROM   reservations
        WHERE  status IN ('paid', 'validated')
        ORDER  BY start_date ASC
      `).all();
      reservations = results.map((r) => ({ ...r, pickup_time: '09:00' }));
    }

    const { results: manualRows } = await env.DB.prepare(
      `SELECT date FROM manual_blocks ORDER BY date ASC`
    ).all();

    return Response.json({
      ok: true,
      reservations,
      manualBlocks: manualRows.map((r) => r.date),
    }, { headers: JSON_HEADERS });

  } catch (err) {
    console.error(
      '[admin-blocks] GET D1 error:', err.message,
      '— si le message contient "no such table: manual_blocks", exécutez la migration : ' +
      'wrangler d1 execute hassan-location-db --file=migration_admin.sql --remote'
    );
    return Response.json({ ok: false, error: 'Erreur serveur' }, { status: 500, headers: JSON_HEADERS });
  }
}

export async function onRequestPost({ request, env }) {
  const authFail = await checkAdminAuth(request, env);
  if (authFail) return authFail;

  if (!env.DB) {
    console.error('[admin-blocks] CONFIG MANQUANTE : binding D1 "DB" introuvable.');
    return Response.json({ ok: false, error: 'Erreur serveur' }, { status: 500, headers: JSON_HEADERS });
  }

  let payload;
  try { payload = await request.json(); }
  catch { return Response.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400, headers: JSON_HEADERS }); }

  const now = new Date().toISOString();

  try {
    switch (payload.action) {

      case 'block-manual': {
        const { date } = payload;
        if (!DATE_RE.test(date || '')) {
          return Response.json({ ok: false, error: 'Date invalide' }, { status: 400, headers: JSON_HEADERS });
        }
        await env.DB.prepare(
          `INSERT INTO manual_blocks (date, created_at) VALUES (?, ?) ON CONFLICT(date) DO NOTHING`
        ).bind(date, now).run();
        return Response.json({ ok: true }, { headers: JSON_HEADERS });
      }

      case 'unblock-manual': {
        const { date } = payload;
        if (!DATE_RE.test(date || '')) {
          return Response.json({ ok: false, error: 'Date invalide' }, { status: 400, headers: JSON_HEADERS });
        }
        await env.DB.prepare(`DELETE FROM manual_blocks WHERE date = ?`).bind(date).run();
        return Response.json({ ok: true }, { headers: JSON_HEADERS });
      }

      case 'cancel-reservation': {
        const { reservationId } = payload;
        if (!reservationId) {
          return Response.json({ ok: false, error: 'reservationId manquant' }, { status: 400, headers: JSON_HEADERS });
        }
        await env.DB.prepare(
          `UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?`
        ).bind(now, reservationId).run();
        return Response.json({ ok: true }, { headers: JSON_HEADERS });
      }

      default:
        return Response.json({ ok: false, error: 'Action inconnue' }, { status: 400, headers: JSON_HEADERS });
    }
  } catch (err) {
    console.error(
      '[admin-blocks] POST D1 error:', err.message,
      '— si le message contient "no such table: manual_blocks", exécutez la migration : ' +
      'wrangler d1 execute hassan-location-db --file=migration_admin.sql --remote'
    );
    return Response.json({ ok: false, error: 'Erreur serveur' }, { status: 500, headers: JSON_HEADERS });
  }
}
