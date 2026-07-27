# Hassan Location — Déploiement Cloudflare Pages

## Architecture

```
Frontend statique  → Cloudflare Pages (index.html, confirmation.html, contrat.html)
Backend serverless → Cloudflare Pages Functions (functions/api/)
Base de données    → Cloudflare D1 (réservations)
Paiement           → Stripe Checkout (session créée côté serveur)
```

## Prérequis

- Compte Cloudflare (gratuit)
- Compte Stripe (gratuit)
- Node.js ≥ 18 installé localement
- Wrangler CLI : `npm install -g wrangler`

---

## 1. Créer la base de données D1

```bash
wrangler d1 create hassan-location-db
```
Copiez le `database_id` retourné et collez-le dans `wrangler.toml`.

```bash
# Appliquer le schéma
wrangler d1 execute hassan-location-db --file=schema.sql
```

---

## 2. Configurer Stripe

1. **Créez vos clés** sur [dashboard.stripe.com](https://dashboard.stripe.com)
2. **Créez un Webhook** :
   - URL : `https://votre-site.pages.dev/api/webhook`
   - Événements à écouter : `checkout.session.completed`, `charge.refunded`
   - Copiez le **Signing Secret** (`whsec_...`)

---

## 3. Déployer sur Cloudflare Pages

### Via GitHub (recommandé)

1. Poussez ce dépôt sur GitHub
2. Allez sur [pages.cloudflare.com](https://pages.cloudflare.com)
3. **Create a project** → connectez votre repo GitHub
4. Paramètres de build :
   - **Build command** : *(laisser vide — pas de build)*
   - **Build output directory** : `/` (ou `.`)
5. Cliquez **Save and Deploy**

### Variables d'environnement (Dashboard → Settings → Variables)

| Variable               | Valeur                       | Chiffré |
|------------------------|------------------------------|---------|
| `STRIPE_SECRET_KEY`    | `sk_live_...`                | ✅ Oui  |
| `STRIPE_WEBHOOK_SECRET`| `whsec_...`                  | ✅ Oui  |
| `SITE_URL`             | `https://votre-site.pages.dev` | Non  |

### Binding D1 (Dashboard → Settings → Functions → D1)

| Binding | Base de données         |
|---------|------------------------|
| `DB`    | `hassan-location-db`   |

---

## 4. Configurer le frontend

Ouvrez `js/config.js` et mettez à jour :

```javascript
STRIPE_PUBLIC_KEY: 'pk_live_VOTRE_CLE_PUBLIQUE',  // clé publique Stripe
SITE_URL: 'https://votre-domaine.pages.dev',
```

---

## 5. Développement local

```bash
# Créer un fichier .dev.vars (git-ignoré)
cat > .dev.vars << EOF
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=http://localhost:8788
EOF

# Lancer en local avec D1
npx wrangler pages dev . --d1=DB
```

---

## Flux complet de réservation

```
1. Utilisateur sélectionne dates dans le calendrier
       ↓
   GET /api/availability → D1 → dates bloquées affichées en gris
       ↓
2. Utilisateur choisit acompte ou paiement total
       ↓
3. Clic "Procéder au paiement"
       ↓
   POST /api/checkout
   ├── Vérifie disponibilité dans D1
   ├── Calcule le montant CÔTÉ SERVEUR
   ├── Crée session Stripe Checkout
   └── Retourne URL de paiement
       ↓
4. Redirection vers Stripe Checkout (paiement sécurisé)
       ↓
5. Stripe redirige vers /confirmation.html?session_id=cs_...
       ↓
   GET /api/reservation?session_id=...
   ├── Cherche dans D1 (si webhook déjà traité)
   └── Fallback : interroge Stripe directement
       ↓
6. En parallèle : Stripe envoie webhook POST /api/webhook
   ├── Vérifie signature HMAC-SHA256
   ├── Insère réservation dans D1 (status = 'paid')
   └── Calendrier grisé automatiquement
       ↓
7. Client signe le contrat (/contrat.html)
   └── Envoie par WhatsApp ou email
       ↓
8. Propriétaire valide manuellement dans D1 :
   UPDATE reservations SET status='validated' WHERE id='HL-...';
       ↓
   Dates définitivement bloquées dans le calendrier
```

## Gestion des statuts (D1)

```sql
-- Valider une réservation (bloquer définitivement les dates)
UPDATE reservations SET status='validated', updated_at=datetime('now') WHERE id='HL-...';

-- Annuler (libérer les dates)
UPDATE reservations SET status='cancelled', updated_at=datetime('now') WHERE id='HL-...';

-- Voir toutes les réservations
SELECT id, start_date, end_date, status, amount_paid, client_email FROM reservations ORDER BY created_at DESC;
```

## Ce qui reste manuel

- **Validation de la réservation** : le propriétaire doit passer status de `paid` → `validated`
  après réception du contrat signé. Il n'y a pas d'interface admin incluse — géré directement en SQL via le Dashboard Cloudflare D1 ou Wrangler.
- **Remboursements** : initié depuis le Dashboard Stripe ; le webhook `charge.refunded` met automatiquement à jour D1.
