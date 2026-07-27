/**
 * POST /api/checkout
 *
 * 1. Valide les dates et le payload
 * 2. Vérifie la disponibilité dans D1 (anti-chevauchement)
 * 3. Calcule le montant CÔTÉ SERVEUR (jamais côté client)
 * 4. Crée la session Stripe Checkout
 * 5. Retourne l'URL de paiement
 *
 * Corps attendu : { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", paymentOption: "deposit"|"full" }
 * Réponse       : { ok: true, url: "https://checkout.stripe.com/..." }
 */

/* ─── Tarification serveur ────────────────────────────────────────
   DOIT être identique à SITE_CONFIG.RATES dans js/config.js.
   En cas de modification des prix, mettre à jour les deux endroits.
   ──────────────────────────────────────────────────────────────── */
function calcAmounts(days, paymentOption) {
  let pricePerDay;
  let label;
  if (days >= 8) { pricePerDay = 150; label = 'Tarif longue durée'; }
  else if (days >= 4) { pricePerDay = 165; label = 'Tarif semaine'; }
  else { pricePerDay = 180; label = 'Tarif standard'; }

  const total   = days * pricePerDay;
  const deposit = Math.ceil(total * 30 / 100); // 30 % d'acompte
  const charged = paymentOption === 'deposit' ? deposit : total;

  return { pricePerDay, label, total, deposit, charged };
}

/* ─── Vérification de disponibilité ─────────────────────────────── */
async function checkAvailability(db, startDate, endDate) {
  // Chevauchement si : start_db < endDate ET end_db > startDate
  const { results } = await db.prepare(`
    SELECT id FROM reservations
    WHERE  status IN ('paid', 'validated')
      AND  start_date < ?
      AND  end_date   > ?
    LIMIT  1
  `).bind(endDate, startDate).all();

  return results.length === 0; // true = disponible
}

/* ─── Création session Stripe (appel REST direct, pas de SDK Node) ── */
async function createStripeSession(secretKey, { chargedCents, description, metadata, successUrl, cancelUrl }) {
  const body = new URLSearchParams({
    'mode':                                                    'payment',
    'payment_method_types[]':                                  'card',
    'line_items[0][price_data][currency]':                     'eur',
    'line_items[0][price_data][unit_amount]':                  String(chargedCents),
    'line_items[0][price_data][product_data][name]':           'Hassan Location – Camion Frigorifique',
    'line_items[0][price_data][product_data][description]':    description,
    'line_items[0][quantity]':                                 '1',
    'success_url':                                             successUrl,
    'cancel_url':                                              cancelUrl,
  });

  for (const [k, v] of Object.entries(metadata)) {
    body.set(`metadata[${k}]`, String(v));
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

/* ─── Handler principal ─────────────────────────────────────────── */
export async function onRequestPost({ request, env }) {
  const h = { 'Content-Type': 'application/json' };

  /* 1. Lire le corps JSON */
  let payload;
  try { payload = await request.json(); }
  catch { return Response.json({ error: 'Corps JSON invalide' }, { status: 400, headers: h }); }

  const { startDate, endDate, paymentOption } = payload;

  /* 2. Validation des champs */
  if (!startDate || !endDate || !paymentOption) {
    return Response.json(
      { error: 'Champs requis : startDate, endDate, paymentOption' },
      { status: 400, headers: h }
    );
  }
  if (!['deposit', 'full'].includes(paymentOption)) {
    return Response.json(
      { error: 'paymentOption doit être "deposit" ou "full"' },
      { status: 400, headers: h }
    );
  }

  /* 3. Validation des dates */
  const today  = new Date(); today.setHours(0, 0, 0, 0);
  const start  = new Date(startDate + 'T00:00:00');
  const end    = new Date(endDate   + 'T00:00:00');

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: 'Format de date invalide (attendu YYYY-MM-DD)' }, { status: 400, headers: h });
  }
  if (start < today) {
    return Response.json({ error: 'La date de début ne peut pas être dans le passé' }, { status: 400, headers: h });
  }
  if (end <= start) {
    return Response.json({ error: 'La date de fin doit être postérieure à la date de début' }, { status: 400, headers: h });
  }

  const days = Math.round((end - start) / 86_400_000);
  if (days < 1 || days > 90) {
    return Response.json({ error: 'La durée doit être comprise entre 1 et 90 jours' }, { status: 400, headers: h });
  }

  /* 4. Vérifier la disponibilité dans D1 */

  // ─── Vérification config : binding D1 "DB" ─────────────────────
  // Si absent, env.DB est `undefined` : on le détecte avant d'appeler
  // checkAvailability() pour logger un message exploitable.
  if (!env.DB) {
    console.error(
      '[checkout] CONFIG MANQUANTE : le binding D1 "DB" est introuvable. ' +
      'À corriger dans Cloudflare Pages → Settings → Bindings → D1 database bindings ' +
      '(variable name = DB, database = hassan-location-db).'
    );
    return Response.json({ error: 'Erreur lors de la vérification de disponibilité' }, { status: 500, headers: h });
  }

  try {
    const available = await checkAvailability(env.DB, startDate, endDate);
    if (!available) {
      return Response.json(
        { error: 'Ces dates ne sont plus disponibles. Veuillez sélectionner d\'autres dates.' },
        { status: 409, headers: h }
      );
    }
  } catch (err) {
    console.error(
      '[checkout] D1 error:', err.message,
      '— si le message contient "no such table", le schéma n\'a pas été appliqué ' +
      'à la base DISTANTE : wrangler d1 execute hassan-location-db --file=schema.sql --remote'
    );
    return Response.json({ error: 'Erreur lors de la vérification de disponibilité' }, { status: 500, headers: h });
  }

  /* 5. Calcul du montant CÔTÉ SERVEUR */
  const { pricePerDay, label, total, deposit, charged } = calcAmounts(days, paymentOption);
  const chargedCents = charged * 100; // Stripe attend des centimes

  /* 6. Créer la session Stripe */

  // ─── Vérification config : variable STRIPE_SECRET_KEY ──────────
  if (!env.STRIPE_SECRET_KEY) {
    console.error(
      '[checkout] CONFIG MANQUANTE : la variable d\'environnement STRIPE_SECRET_KEY ' +
      'est introuvable. À ajouter (chiffrée) dans Cloudflare Pages → Settings → ' +
      'Environment variables → Production.'
    );
    return Response.json({ error: 'Erreur lors de la création du paiement. Réessayez.' }, { status: 500, headers: h });
  }

  const siteUrl = env.SITE_URL || 'https://hassan-location.pages.dev';
  const description = `${days} jour(s) · Du ${startDate} au ${endDate} · ${label} · ${
    paymentOption === 'deposit' ? `Acompte 30% (${deposit}€)` : `Paiement intégral (${total}€)`
  }`;

  const metadata = {
    start_date:      startDate,
    end_date:        endDate,
    days:            days,
    rate_per_day:    pricePerDay,
    total_amount:    total,
    deposit_amount:  deposit,
    amount_charged:  charged,
    payment_option:  paymentOption,
  };

  let session;
  try {
    session = await createStripeSession(env.STRIPE_SECRET_KEY, {
      chargedCents,
      description,
      metadata,
      successUrl: `${siteUrl}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${siteUrl}/index.html?cancelled=true`,
    });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return Response.json({ error: 'Erreur lors de la création du paiement. Réessayez.' }, { status: 500, headers: h });
  }

  /* 7. Retourner l'URL de paiement */
  return Response.json({
    ok:     true,
    url:    session.url,
    // Infos affichées côté client uniquement (affichage, non sensibles)
    amount: charged,
    total,
    days,
  }, { headers: h });
}
