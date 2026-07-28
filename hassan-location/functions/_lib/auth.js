/**
 * functions/_lib/auth.js
 *
 * Vérification Basic Auth pour l'administration du planning.
 * Fichier préfixé par "_" : ignoré par le routeur Cloudflare Pages
 * Functions, importable depuis les autres fonctions.
 *
 * Identifiants attendus dans les variables d'environnement :
 *   ADMIN_USER, ADMIN_PASSWORD  (à définir côté Cloudflare Pages,
 *   chiffrées — jamais commitées dans le code).
 *
 * Utilisation :
 *   const authFail = await checkAdminAuth(request, env);
 *   if (authFail) return authFail; // 401 ou 500 à renvoyer tel quel
 */

const REALM = 'planning-admin';

export async function checkAdminAuth(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
    console.error(
      '[admin-auth] CONFIG MANQUANTE : ADMIN_USER / ADMIN_PASSWORD introuvables. ' +
      'À ajouter dans Cloudflare Pages → Settings → Environment variables.'
    );
    return new Response('Configuration admin manquante côté serveur', { status: 500 });
  }

  const unauthorized = () => new Response('Authentification requise', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}"`,
      'Cache-Control': 'no-store',
    },
  });

  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Basic ')) return unauthorized();

  let decoded;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return unauthorized();
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return unauthorized();

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  const [userOk, passOk] = await Promise.all([
    timingSafeEqual(user, env.ADMIN_USER),
    timingSafeEqual(pass, env.ADMIN_PASSWORD),
  ]);

  if (!userOk || !passOk) return unauthorized();

  return null; // authentifié — laisser passer
}

/* Comparaison à temps constant (évite les attaques par timing) */
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
