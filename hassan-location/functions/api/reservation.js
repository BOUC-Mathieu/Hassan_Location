/**
 * GET /api/reservation?session_id=cs_...
 *
 * Retourne les détails d'une réservation pour la page confirmation.html.
 *
 * Stratégie :
 *   1. Cherche dans D1 (webhook déjà traité)
 *   2. Fallback : interroge Stripe directement si le webhook n'est pas
 *      encore arrivé (délai courant de quelques secondes)
 *
 * Réponse : { ok: true, reservation: {...}, source: 'db'|'stripe' }
 */
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

    return Response.json({
      ok:     true,
      source: 'stripe', // webhook encore en transit
      reservation: {
        id:                   null,
        stripe_session_id:    session.id,
        stripe_payment_intent: session.payment_intent || '',
        start_date:           m.start_date,
        end_date:             m.end_date,
        days:                 parseInt(m.days, 10),
        pickup_time:          m.pickup_time || '09:00',
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
