# FinancIAl

Suivi personnel de patrimoine : Next.js statique, Supabase Auth/Postgres, graphiques Recharts. Interface sombre et responsive. Aucun serveur Next.js nécessaire.

## Démarrer

Node.js 22 recommandé.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

L’application nécessite une configuration Supabase et une connexion pour afficher le portefeuille. Sans configuration, un message d’erreur est affiché ; aucun portefeuille fictif n’est chargé. Les données fictives sont réservées aux tests et ne sont pas incluses dans l’application. Aucune donnée du Google Sheet personnel n’est incluse dans le dépôt ou le build.

## Installer sur smartphone (PWA)

Depuis le site déployé en **HTTPS** (GitHub Pages convient) :

- **Android / Chrome** : appuyer sur « Installer FinancIAl » lorsque le navigateur le propose, ou ouvrir le menu ⋮ → Installer l’application / Ajouter à l’écran d’accueil.
- **iPhone / iPad** : ouvrir le site dans **Safari**, puis Partager → Sur l’écran d’accueil → Ajouter. Le bouton « Installer FinancIAl » rappelle ces étapes.

L’icône ouvre FinancIAl en fenêtre autonome, sans barre d’adresse. Le manifeste, les icônes et le service worker prennent en charge le sous-chemin GitHub Pages (`NEXT_PUBLIC_BASE_PATH`). L’installation n’est pas disponible depuis une simple adresse HTTP sur le réseau local ; utiliser HTTPS pour tester sur un téléphone (`localhost` est accepté uniquement sur l’appareil lui-même).

Une connexion Internet reste nécessaire pour consulter et modifier le portefeuille. Le service worker conserve **uniquement une page publique hors connexion**, jamais les réponses d’API, les pages du portefeuille ni les données d’authentification. La persistance habituelle de la session dans le navigateur reste inchangée.

## Configurer Supabase (étape manuelle)

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans le SQL Editor (une fois).
3. Créer ton utilisateur dans Authentication → Users avec e-mail et mot de passe. Désactiver « Allow new users to sign up » dans les paramètres Auth.
4. Autoriser uniquement son UUID depuis le SQL Editor :

```sql
insert into public.portfolio_owner(user_id) values ('UUID_DE_TON_COMPTE');
```

5. Renseigner `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans `.env.local`, puis relancer le serveur. Utiliser exclusivement la clé publique/publishable (ou anon historique), **jamais service_role / secret**.
6. Se connecter. Les politiques RLS bloquent l’accès anonyme et tout compte non autorisé, même si une inscription était réactivée. L’autorisation n’est pas un simple contrôle d’interface.

Le portefeuille est pour l'instant un document JSONB privé versionné par ses relevés, associé au compte propriétaire. Les données de marché utilisent des tables séparées (voir ci-dessous) ; la normalisation complète des comptes/placements/relevés reste une évolution distincte. Les mises à jour du portefeuille sont atomiques. V1 personnelle : éviter l’édition simultanée sur plusieurs appareils (la dernière sauvegarde gagne). Les positions et montants privés ne transitent pas par GitHub Actions : le script ne connaît que les symboles publics. Aucun stockage local persistant des finances ; Supabase conserve la session d’authentification dans le navigateur. Se déconnecter sur un appareil partagé.

## Importer le Google Sheet

Onglet **Saisie des données → Importer Google Sheets** :

1. Télécharger séparément les onglets Évolution, Portefeuille, SCPI et Actions via Fichier → Télécharger → CSV. Ne pas rendre le Sheet public.
2. Sélectionner les quatre fichiers. Les colonnes doivent garder l’ordre actuel :
   - Évolution : Période, Montant (les colonnes de synthèse à droite sont ignorées).
   - Portefeuille : Support, Taux, Montant, Annuel, Mensuel, Code.
   - SCPI : Nom, Montant, Rendement.
   - Actions : Nom, Montant, Code, Rendement, Support, Dividende moyen annualisé.
3. Indiquer la **date du détail actuel** et la date **à partir de laquelle les valeurs sont des projections**. Ces dates sont explicites : le programme ne les déduit pas de la date du jour.
4. Prévisualiser et vérifier les relevés. Les valeurs vides d’Évolution sont ignorées. Les dates françaises, espaces de milliers et virgules décimales sont pris en charge.
5. Exporter une sauvegarde si nécessaire, puis confirmer le remplacement.

Les totaux SCPI/actions sont rapprochés avec le détail (tolérance 0,02 €). Une différence bloque l’import. Le détail doit correspondre au total d’Évolution pour la date choisie, avec une tolérance de 1 € liée aux arrondis. L’historique global n’est **pas** artificiellement décliné par placement.

Les colonnes I:L de l'onglet Actions (Nom, Montant, Code, Rendement) servent à remplacer la ligne ETF Monde par WPEA et DCAM. Leur somme doit correspondre au montant agrégé. Les deux lignes conservent le regroupement d'affichage « ETF Monde » ; celui-ci n'ajoute jamais de capital. Sans ces colonnes, ETF Monde reste agrégé avec un avertissement et un taux manuel, à décomposer avant de pouvoir l'automatiser. Les codes reconnus activent le mode marché automatiquement ; CGI reste manuel. Le dividende annualisé manuel JEQP n'est pas ajouté au rendement de marché (déjà distributions comprises).

Les fichiers ne sont transmis nulle part avant confirmation ; la confirmation sauvegarde uniquement le résultat dans ton Supabase. Ne jamais committer les exports privés (`imports/` est ignoré).

## Calculs V1

- Gain annuel estimé = somme des montants × taux annuel / 100. Mensuel = annuel / 12.
- Les nouveaux imports recalculent les taux Actions et SCPI depuis les lignes détaillées. **JEQP est inclus** dans la moyenne pondérée Actions, contrairement à l'ancienne formule du Sheet. Les taux de synthèse hérités sont ignorés dès qu'une catégorie contient un placement en mode marché. Les autres taux de synthèse restent modifiables dans chaque relevé.
- ETF Monde : moyenne pondérée des performances WPEA/DCAM par leurs montants, pas moyenne simple.
- Rendement global = gain annuel estimé / capital détaillé.
- Total en tête = première projection après le dernier relevé réel, sinon dernier relevé réel.
- Gain du mois = cette projection − dernier relevé réel. Sans projection : variation entre les deux derniers relevés réels. Les apports/retraits ne sont pas isolés : ce n’est pas une performance financière nette des flux.
- Le dernier relevé **détaillé** fournit les répartitions et taux ; sa date est affichée. Une projection globale ne fabrique pas de détail.
- Une projection ne devient jamais réelle automatiquement : modifier sa nature et valider le relevé à la clôture.

## Rendements automatiques sur 365 jours

### Source et méthode

Le fournisseur initial est **Yahoo Finance**, via son endpoint chart non officiel. Registre : WPEA.PA, DCAM.PA, PCEU.PA, PAEEM.PA, PAASI.PA et JEQP.L, ainsi que GLD et BTC-EUR pour conserver les automatismes or/bitcoin du Sheet. L'adaptateur est isolé dans `scripts/lib/yahoo.ts` pour permettre un remplacement par une API contractuelle. Yahoo peut changer son accès ou appliquer des quotas : ce service n'est pas garanti. Vérifier ses conditions pour l'usage personnel.

La synchronisation récupère deux ans de clôtures et utilise `adjusted_close`, ajusté des divisions et distributions selon Yahoo. Performance = `(clôture ajustée finale / clôture ajustée initiale − 1) × 100`, sans ajout de dividende manuel. Il s'agit d'une approximation de rendement total, distributions réinvesties, dépendante de la qualité fournisseur, pas d'un revenu encaissé ni d'une prévision.

- Fin : dernière clôture d'un jour strictement antérieur au jour UTC courant (exclusion des bougies intraday).
- Début : premier jour coté à partir de **la date de fin moins 365 jours**, au maximum 7 jours après la cible. Pas d'annualisation artificielle si l'historique est insuffisant.
- Un cours de clôture vieux de plus de 7 jours bloque le calcul.
- Devise vérifiée pour chaque instrument. JEQP.L est coté en **GBp** ; ne pas le remplacer par le JEPQ américain. Les pourcentages sont en devise de cotation : **pas de conversion de performance en EUR**, et pas d'effet de change ajouté au portefeuille. Les montants restent ceux saisis en euros.
- L'approximation peut différer de Google Finance : clôture précédente au lieu du cours intraday, distributions réinvesties et référence glissante rattachée à la dernière clôture.

### Tables et sécurité

Exécuter `supabase/migrations/001_market.sql` une fois, après `supabase/schema.sql` :

| Table | Rôle |
|---|---|
| `market_instruments` | Registre des huit cotations et devises autorisées |
| `market_prices` | Clôtures brutes et ajustées par date, source Yahoo |
| `market_returns` | Dernière performance valide, dates et prix de référence, méthode et date de récupération |
| `market_sync_status` | Dernière tentative et erreur éventuelle |
| `market_sync_secrets` | Empreinte du jeton de synchronisation, inaccessible aux clients |

Le navigateur authentifié propriétaire peut lire les données de marché mais pas les écrire. Le script utilise la RPC `sync_market_instrument` avec un jeton spécifique : elle ne peut modifier **que les données de marché**, jamais les comptes ni le document portefeuille. Aucune clé `service_role` nécessaire. Les prix sont contrôlés et la performance est recalculée en SQL.

Les fonctions privilégiées sont isolées dans le schéma non exposé `financial_private`. La fonction REST publique de synchronisation est un wrapper `SECURITY INVOKER` ; l'implémentation privée vérifie le jeton. Les privilèges implicites de Supabase sont révoqués avant les autorisations explicites, notamment `TRUNCATE`, et le trigger système `rls_auto_enable` n'est pas exécutable depuis l'API. Les deux tables d'administration (`portfolio_owner`, `market_sync_secrets`) n'ont volontairement aucune politique client : accès refusé par défaut, même après connexion.

### Activer la GitHub Action quotidienne

1. Générer localement un jeton aléatoire : `openssl rand -hex 32`. Ne pas le committer ni le mettre dans une variable `NEXT_PUBLIC_*`.
2. Dans le SQL Editor, enregistrer son empreinte (remplacer le texte par le jeton généré) :

```sql
insert into public.market_sync_secrets(singleton, token_sha256)
values(true, encode(sha256(convert_to('TON_JETON_ALEATOIRE', 'UTF8')), 'hex'))
on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
```

3. Dans GitHub → Settings → Secrets and variables → Actions, ajouter le **secret** `MARKET_SYNC_TOKEN` avec le même jeton. L'URL et la clé publique utilisent les deux variables déjà configurées pour le déploiement.
4. Pousser sur la branche par défaut. Dans Actions, lancer **Synchroniser les rendements de marché** manuellement pour amorcer les valeurs.
5. Le workflow `.github/workflows/sync-market.yml` tourne quotidiennement à **06:17 UTC**, y compris le week-end. GitHub peut retarder les exécutions planifiées et désactiver les schedules des dépôts publics inactifs ; contrôler les journaux.

### Comportement dans l'application

Le dashboard lit les dernières performances depuis Supabase, au chargement puis toutes les cinq minutes, sans reconstruire le site. Un bouton relit les données stockées : il ne déclenche pas l'appel Yahoo. Chaque placement a un mode manuel ou marché et un regroupement facultatif dans Saisie. Le taux de marché est en lecture seule ; repasser en manuel permet un remplacement explicite.

Les taux automatiques du dashboard sont superposés à l'estimation courante, **sans réécriture des anciens relevés**. Lorsqu'un relevé nouveau ou explicitement modifié est enregistré, son taux connu et sa date de marché sont figés dans le relevé. Une modification des objectifs ne réactualise pas les anciens relevés. Une panne conserve la dernière performance valide et affiche un avertissement ; avant la première synchronisation, le taux du relevé sert de repli.

### Tester sans aucune écriture

```bash
npm run market:check
```

Pour une écriture locale, créer un fichier privé `.env.market` contenant `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `MARKET_SYNC_TOKEN`, puis exécuter `node --env-file=.env.market --import tsx scripts/sync-market.ts`. Les fichiers `.env*` sont ignorés par Git. Les journaux ne contiennent que des cotations publiques et performances, pas les positions ou secrets.

## Déployer sur GitHub Pages

1. Dans Settings → Pages, choisir **GitHub Actions** comme source. La disponibilité pour un dépôt privé dépend de ton offre GitHub.
2. Dans Settings → Secrets and variables → Actions → **Variables**, créer `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Pousser sur `main` : `.github/workflows/deploy.yml` installe, vérifie les types, teste, exporte et déploie `out/`.

Le chemin `/NOM_DU_REPO` est calculé par l’Action ; les dépôts `*.github.io` utilisent la racine. Pour un domaine personnalisé, adapter `NEXT_PUBLIC_BASE_PATH` dans le workflow. Authentification par mot de passe : aucun callback serveur. Pas de Route Handlers, Server Actions ou dépendance à un runtime Node en production. Les données sont chargées depuis Supabase après connexion, pas pendant la compilation. La clé publique est visible par conception : la protection repose sur RLS.

## Vérifications

```bash
npm run typecheck
npm test
npm run build
```

`out/` contient le site déployable. Pour vérifier localement le sous-chemin GitHub Pages : `NEXT_PUBLIC_BASE_PATH=/FinancIAl npm run build`.

Le schéma SQL et les politiques RLS doivent également être testés sur ton projet réel : connecté comme propriétaire, créer/lire/modifier un relevé ; déconnecté ou avec un autre compte, aucune lecture/écriture ne doit être autorisée. L’import initial et le déploiement réel nécessitent ta configuration Supabase/GitHub et ne sont pas exécutés automatiquement depuis ce dépôt.

Tests SQL reproductibles dans un PostgreSQL 17 jetable uniquement : exécuter successivement `tests/sql/bootstrap.sql`, `supabase/schema.sql`, `supabase/migrations/001_market.sql`, puis `tests/sql/market-security.sql`. Le bootstrap simule les rôles Supabase ; **ne jamais l'exécuter sur le projet réel**. Ces tests couvrent le jeton invalide, les droits limités, le propriétaire/non-propriétaire, le recalcul serveur et la conservation du dernier résultat après échec.
