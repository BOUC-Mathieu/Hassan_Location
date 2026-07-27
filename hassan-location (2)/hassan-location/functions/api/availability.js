/**
 * GET /api/availability
 *
 * Retourne les plages de dates bloquées depuis D1.
 * Utilisé par le calendrier du frontend pour griser les jours non disponibles.
 *
 * Réservations bloquantes : status IN ('paid', 'validated')
 * Réservations libres     : status IN ('cancelled', 'refunded')
 *
 * Réponse : { ok: true, blocked: [{ start_date, end_date, status }] }
 */
export async function onRequestGet({ env }) {
  const headers = {
    'Content-Type':  'application/json',
    'Cache-Control': 'public, max-age=60', // 1 min — calendrier quasi-temps réel
  };

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const { results } = await env.DB.prepare(`
      SELECT start_date, end_date, status
      FROM   reservations
      WHERE  status IN ('paid', 'validated')
        AND  end_date >= ?
      ORDER  BY start_date ASC
    `).bind(today).all();

    return Response.json({ ok: true, blocked: results }, { headers });

  } catch (err) {
    console.error('[availability] DB error:', err);
    // En cas d'erreur DB, retourner un tableau vide plutôt que bloquer le site
    return Response.json(
      { ok: false, blocked: [], error: 'Erreur serveur' },
      { status: 500, headers }
    );
  }
}
