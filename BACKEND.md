# Backend Vendora (fonctions serverless Vercel)

Le site est statique (HTML) **+** un backend en fonctions serverless dans `/api`.
Tout est servi par le même projet Vercel → le front appelle `/api/...` en même origine.

## Routes

| Route | Rôle |
|---|---|
| `POST /api/generate` | Améliore la photo via le backend Render (Gemini), débite 100 crédits (ou 1 aperçu gratuit flouté), archive la génération. |
| `GET /api/preview` | Statut de l'aperçu gratuit (verrouillé/débloqué + URL signée). |
| `GET /api/generations` | Historique des générations payantes (URLs signées). |
| `POST /api/checkout` | Crée une session Stripe Checkout (abonnement ou recharge). |
| `POST /api/portal` | Ouvre le portail client Stripe (gérer/résilier). |
| `POST /api/stripe/webhook` | Crédite les comptes après paiement (signature vérifiée, idempotent). |

`lib/` = helpers partagés (Supabase admin, produits Stripe, HTTP/CORS).
`supabase/*.sql` = schéma à exécuter dans Supabase (SQL Editor). Commencer par `setup.sql`.

## Variables d'environnement (Vercel → Settings → Environment Variables)

Voir `.env.example`. À définir :

- `RENDER_API_URL` — backend FastAPI (Render) qui applique le fond.
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — même projet Supabase que le front.
- `SUPABASE_SERVICE_ROLE_KEY` — **serveur uniquement** (crédite/débite).
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.

## Déploiement Vercel

1. Le repo contient un `package.json` (deps des fonctions) → Vercel installe et compile `/api` tout seul.
   - Framework Preset : **Other**. Build Command : *(vide)*. Output Directory : `.` (racine, fichiers statiques).
2. Poser les variables d'env ci-dessus (Production + Preview).
3. Webhook Stripe → endpoint `https://<domaine>/api/stripe/webhook` (événements : `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`).
4. `api/generate` a `maxDuration: 300` (dans `vercel.json`) → nécessite **Vercel Pro** (sinon coupé à 60s).

⚠️ Tant que les variables d'env ne sont pas posées, `/api/generate` renverra une erreur (le reste du site statique fonctionne).
