/**
 * POST /api/webhook
 *
 * Reçoit les événements Stripe et met à jour D1.
 *
 * Événements traités :
 *  - checkout.session.completed → crée la réservation en status 'paid'
 *  - charge.refunded            → passe la réservation en 'refunded' (libère les dates)
 *
 * Sécurité : vérification de la signature Stripe via Web Crypto API
 * (pas de Node.js crypto — compatible Cloudflare Workers)
 *
 * Variable d'environnement requise : STRIPE_WEBHOOK_SECRET (whsec_...)
 */

/* ─── Vérification signature Stripe (HMAC-SHA256, Web Crypto API) ── */
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Stripe-Signature header manquant');
  if (!secret)    throw new Error('STRIPE_WEBHOOK_SECRET non configuré');

  const parts     = sigHeader.split(',');
  const tPart     = parts.find(p => p.startsWith('t='));
  const v1Parts   = parts.filter(p => p.startsWith('v1='));

  if (!tPart || !v1Parts.length) throw new Error('Stripe-Signature malformé');

  const timestamp = tPart.slice(2);

  // Tolérance de 5 minutes contre les replay attacks
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    throw new Error('Timestamp Stripe trop ancien');
  }

  const signedPayload = `${timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computed  = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (!v1Parts.map(p => p.slice(3)).includes(computed)) {
    throw new Error('Signature Stripe invalide');
  }
}

/* ─── Génération ID de réservation ─────────────────────────────── */
function genId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `HL-${ts}-${rand}`;
}

/* ─── Handler ───────────────────────────────────────────────────── */
export async function onRequestPost({ request, env }) {

  /* 1. Lire le body brut (obligatoire pour la vérification) */
  const rawBody   = await request.text();
  const sigHeader = request.headers.get('stripe-signature');

  /* 2. Vérifier la signature */
  try {
    await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature invalide:', err.message);
    return new Response('Unauthorized', { status: 401 });
  }

  /* 3. Parser l'événement */
  let event;
  try { event = JSON.parse(rawBody); }
  catch { return new Response('JSON invalide', { status: 400 }); }

  const now = new Date().toISOString();

  try {
    switch (event.type) {

      /* ── Paiement complété ── */
      case 'checkout.session.completed': {
        const session  = event.data.object;
        if (session.payment_status !== 'paid') break; // ex: bancontact async

        const { metadata } = session;
        const id = genId();

        await env.DB.prepare(`
          INSERT INTO reservations
            (id, stripe_session_id, stripe_payment_intent,
             start_date, end_date, days,
             rate_per_day, total_amount, deposit_amount,
             payment_option, amount_paid,
             status, client_email, created_at, updated_at)
          VALUES
            (?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?,
             'paid', ?, ?, ?)
          ON CONFLICT(stripe_session_id) DO UPDATE SET
            stripe_payment_intent = excluded.stripe_payment_intent,
            status     = 'paid',
            updated_at = excluded.updated_at
        `).bind(
          id,
          session.id,
          session.payment_intent || '',
          metadata.start_date,
          metadata.end_date,
          parseInt(metadata.days, 10),
          parseInt(metadata.rate_per_day, 10),
          parseInt(metadata.total_amount, 10),
          parseInt(metadata.deposit_amount, 10),
          metadata.payment_option,
          Math.round(session.amount_total / 100), // centimes → euros
          session.customer_details?.email || '',
          now,
          now
        ).run();

        console.log(`[webhook] Réservation ${id} enregistrée : ${metadata.start_date} → ${metadata.end_date}`);
        break;
      }

      /* ── Remboursement → libère les dates ── */
      case 'charge.refunded': {
        const paymentIntent = event.data.object.payment_intent;
        if (!paymentIntent) break;

        await env.DB.prepare(`
          UPDATE reservations
          SET    status = 'refunded', updated_at = ?
          WHERE  stripe_payment_intent = ?
            AND  status NOT IN ('cancelled')
        `).bind(now, paymentIntent).run();

        console.log(`[webhook] Réservation remboursée : payment_intent=${paymentIntent}`);
        break;
      }

      default:
        // Ignorer silencieusement les événements non gérés
        break;
    }
  } catch (err) {
    console.error('[webhook] Erreur handler:', err);
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
