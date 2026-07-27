/**
 * GET /api/diagnostic
 *
 * ⚠️ OUTIL DE DIAGNOSTIC TEMPORAIRE ⚠️
 * Ajouté pour identifier précisément pourquoi /api/availability et
 * /api/checkout renvoyaient une erreur 500. À ouvrir une fois dans le
 * navigateur juste après le déploiement, puis à SUPPRIMER (ce fichier ne
 * doit pas rester en production indéfiniment).
 *
 * Ne révèle AUCUNE valeur secrète : uniquement des booléens, le mode
 * test/live de Stripe (jamais la clé elle-même), et le nombre de lignes
 * en base.
 *
 * Réponse : { ok, summary, d1: {...}, stripe: {...}, env: {...} }
 */
export async function onRequestGet({ env }) {
  const report = {
    d1: {
      bindingPresent:   false,
      canQuery:         false,
      tableExists:      false,
      reservationCount: null,
      error:            null
    },
    stripe: {
      secretKeyPresent:     false,
      secretKeyMode:        null,
      webhookSecretPresent: false
    },
    env: {
      SITE_URL: env.SITE_URL || '(non défini — le code utilise le fallback https://hassan-location.pages.dev)'
    }
  };

  /* ─── D1 : binding, connexion, table, contenu ────────────────── */
  if (env.DB) {
    report.d1.bindingPresent = true;
    try {
      await env.DB.prepare('SELECT 1').first();
      report.d1.canQuery = true;

      try {
        const t = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'"
        ).first();
        report.d1.tableExists = !!t;

        if (t) {
          const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM reservations').first();
          report.d1.reservationCount = c ? c.n : 0;
        } else {
          report.d1.error = 'La table "reservations" n\'existe pas sur cette base. ' +
            'Exécutez : wrangler d1 execute hassan-location-db --file=schema.sql --remote';
        }
      } catch (e) {
        report.d1.error = 'Erreur lors de la vérification de la table : ' + e.message;
      }
    } catch (e) {
      report.d1.error = 'Le binding "DB" existe mais la requête a échoué : ' + e.message;
    }
  } else {
    report.d1.error = 'Binding D1 "DB" introuvable — à ajouter dans Cloudflare Pages → ' +
      'Settings → Bindings → D1 database bindings (variable name = DB, ' +
      'database = hassan-location-db).';
  }

  /* ─── Stripe : présence des variables (jamais leur valeur) ───── */
  if (env.STRIPE_SECRET_KEY) {
    report.stripe.secretKeyPresent = true;
    report.stripe.secretKeyMode =
      env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' :
      env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'test' : 'format inattendu';
  }
  report.stripe.webhookSecretPresent = !!env.STRIPE_WEBHOOK_SECRET;

  /* ─── Verdict global ──────────────────────────────────────────── */
  const ok = report.d1.bindingPresent && report.d1.canQuery &&
             report.d1.tableExists && report.stripe.secretKeyPresent;

  return Response.json({
    ok,
    summary: ok
      ? '✅ Configuration correcte : D1 et Stripe sont bien liés. availability/checkout devraient fonctionner.'
      : '⚠️ Configuration incomplète — voir "d1" et "stripe" ci-dessous pour savoir précisément quoi corriger.',
    ...report
  }, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
