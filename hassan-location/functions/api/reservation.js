/**
 * GET /api/reservation?session_id=cs_...
 *
 * Retourne les détails d'une réservation pour la page confirmation.html.
 *
 * Stratégie :
 *   1. Cherche dans D1 (webhook déjà traité)
 *   2. Fallback : interroge Stripe directement si le webhook n'est pas
 *      encore arrivé (délai courant de quelques secondes), ET écrit la
 *      réservation en base à ce moment-là (filet de sécurité si le
 *      webhook Stripe est mal configuré ou échoue silencieusement —
 *      sans ce filet, le paiement s'affiche confirmé mais les dates ne
 *      sont jamais bloquées côté calendrier/admin). Écriture idempotente
 *      (ON CONFLICT DO UPDATE) : si le webhook écrit ensuite la même
 *      ligne, aucun doublon ni conflit.
 *
 * Réponse : { ok: true, reservation: {...}, source: 'db'|'stripe' }
 */

/* ─── Génération ID de réservation (identique à webhook.js) ──────── */
function genId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `HL-${ts}-${rand}`;
}

export async function onRequestGet({ request, env }) {
  const h         = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const url       = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  /* Validation basique */
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return Response.json({ error: 'session_id manquant ou invalide' }, { status: 400, headers: h });
  }

  /* 1. Chercher dans D1 */
  if (!env.DB) {
    console.error(
      '[reservation] CONFIG MANQUANTE : le binding D1 "DB" est introuvable ' +
      '(Cloudflare Pages → Settings → Bindings → D1 database bindings). ' +
      'Bascule sur le fallback Stripe ci-dessous.'
    );
  } else {
    try {
      const row = await env.DB.prepare(
        'SELECT * FROM reservations WHERE stripe_session_id = ?'
      ).bind(sessionId).first();

      if (row) {
        return Response.json({ ok: true, reservation: row, source: 'db' }, { headers: h });
      }
    } catch (err) {
      console.error(
        '[reservation] D1 error:', err.message,
        '— si le message contient "no such table", le schéma n\'a pas été appliqué ' +
        'à la base DISTANTE : wrangler d1 execute hassan-location-db --file=schema.sql --remote'
      );
      // On continue vers le fallback Stripe
    }
  }

  /* 2. Fallback Stripe — webhook probablement en transit */
  try {
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Stripe-Version': '2023-10-16',
        }
      }
    );

    if (!stripeRes.ok) {
      return Response.json({ error: 'Session Stripe introuvable' }, { status: 404, headers: h });
    }

    const session = await stripeRes.json();

    if (session.payment_status !== 'paid') {
      return Response.json({ error: 'Paiement non complété' }, { status: 402, headers: h });
    }

    const m = session.metadata;
    const pickupTime = m.pickup_time || '09:00';
    let   id          = null;

    /* ─── Filet de sécurité : écrire en base même si le webhook Stripe
       n'est pas (encore, ou jamais) passé, pour que les dates soient
       bloquées immédiatement au chargement de la page confirmation. ─── */
    if (env.DB) {
      try {
        id = genId();
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO reservations
            (id, stripe_session_id, stripe_payment_intent,
             start_date, end_date, days, pickup_time,
             rate_per_day, total_amount, deposit_amount,
             payment_option, amount_paid,
             status, client_email, created_at, updated_at)
          VALUES
            (?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?,
             'paid', ?, ?, ?)
          ON CONFLICT(stripe_session_id) DO UPDATE SET
            stripe_payment_intent = excluded.stripe_payment_intent,
            pickup_time = excluded.pickup_time,
            status     = 'paid',
            updated_at = excluded.updated_at
        `).bind(
          id,
          session.id,
          session.payment_intent || '',
          m.start_date,
          m.end_date,
          parseInt(m.days, 10),
          pickupTime,
          parseInt(m.rate_per_day, 10),
          parseInt(m.total_amount, 10),
          parseInt(m.deposit_amount, 10),
          m.payment_option,
          Math.round(session.amount_total / 100),
          session.customer_details?.email || '',
          now,
          now
        ).run();

        // Récupère l'id réel si la ligne existait déjà (ON CONFLICT DO UPDATE ne retourne pas l'id existant)
        const existing = await env.DB.prepare(
          'SELECT id FROM reservations WHERE stripe_session_id = ?'
        ).bind(session.id).first();
        if (existing) id = existing.id;

        console.log(`[reservation] Filet de sécurité : réservation ${id} écrite en base (webhook non détecté).`);
      } catch (err) {
        console.error(
          '[reservation] Échec de l\'écriture de secours en base:', err.message,
          '— la réservation reste affichée via Stripe mais les dates ne seront pas bloquées ' +
          'tant que ce problème n\'est pas résolu (vérifier le schéma D1 distant).'
        );
        id = null;
      }
    }

    return Response.json({
      ok:     true,
      source: 'stripe', // webhook probablement non traité — écrit en base ci-dessus par filet de sécurité
      reservation: {
        id:                   id,
        stripe_session_id:    session.id,
        stripe_payment_intent: session.payment_intent || '',
        start_date:           m.start_date,
        end_date:             m.end_date,
        days:                 parseInt(m.days, 10),
        pickup_time:          pickupTime,
        rate_per_day:         parseInt(m.rate_per_day, 10),
        total_amount:         parseInt(m.total_amount, 10),
        deposit_amount:       parseInt(m.deposit_amount, 10),
        payment_option:       m.payment_option,
        amount_paid:          Math.round(session.amount_total / 100),
        status:               'paid',
        client_email:         session.customer_details?.email || '',
      }
    }, { headers: h });

  } catch (err) {
    console.error('[reservation] Stripe fallback error:', err);
    return Response.json({ error: 'Erreur serveur' }, { status: 500, headers: h });
  }
}
