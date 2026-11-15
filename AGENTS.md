<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Vérification navigateur : MCP `playwright` uniquement

Tout test dans un navigateur passe par le MCP **`playwright`** (`playwright_browser_navigate`, `playwright_browser_snapshot`, `playwright_browser_click`, `playwright_browser_evaluate`, `playwright_browser_take_screenshot`).

- **Ne jamais utiliser le MCP `browse`** pour vérifier l'application : il pilote un autre Chrome, sans la session Supabase, et affiche l'écran de connexion au lieu du portefeuille.
- **Ne jamais fabriquer de données de démonstration** (`tests/fixtures/portfolio.ts`, page de preview temporaire, valeurs inventées) pour montrer un résultat : la vérification se fait sur les vraies données de l'utilisateur, sinon elle ne prouve rien.
- Identifiants de connexion : `.env.local` (`FINANCIAL_LOGIN`, `FINANCIAL_PASSWORD`). Les lire sans jamais les afficher, les citer ou les écrire ailleurs que dans le formulaire de connexion.
- Le profil du MCP `playwright` conserve la session : si l'application s'ouvre déjà connectée (compte visible en bas de la sidebar), ne pas ressaisir le mot de passe.

Recette :

> **Important — une seule base Supabase, partagée entre dev et production.**
>
> Il n'existe **qu'une seule base de données Supabase** : elle sert à la fois au développement et à la production. Toute écriture pendant une recette est donc une écriture en production.
>
> - **Aucune modification de données** : ne jamais créer, mettre à jour ou supprimer des lignes (ni via l'interface, ni via l'API, ni via le MCP `supabase`). Seule la **lecture** est autorisée, et elle se fait **via l'interface**.
> - **Exception** : si l'évolution demandée nécessite des opérations d'écriture en base (migration, correction de données), elles sont autorisées dans le cadre de cette évolution — pas au-delà.

1. `npm run dev` (port 3000) si le serveur ne répond pas, puis `playwright_browser_navigate` vers `http://localhost:3000/`.
2. Si l'écran d'accueil s'affiche : cliquer « Accéder à mon portefeuille », remplir « Adresse e-mail » et « Mot de passe », puis « Se connecter ».
3. Vérifier le rendu dans **Vue d'ensemble** et dans **Portefeuille boursier** (ce sont deux vues distinctes avec des chiffres différents).
4. Relever les valeurs réellement affichées (`playwright_browser_evaluate` sur `.metric strong`, `.legend b`, `.stock-tile`, `.stock-table`, axes `.recharts-cartesian-axis-tick-value`) et joindre une capture avant de conclure.
5. Ne jamais valider une modification d'affichage sans cette vérification sur les vraies données.
