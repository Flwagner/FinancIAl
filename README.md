# FinancIAl

Suivi personnel de patrimoine : Next.js statique, Supabase Auth/Postgres, graphiques Recharts. Interface sombre et responsive. Aucun serveur Next.js nécessaire.

## Démarrer

Node.js 22 recommandé.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

L’application nécessite une configuration Supabase et une connexion pour afficher le portefeuille. Sans configuration, un message d’erreur est affiché ; aucun portefeuille fictif n’est chargé. Les données fictives sont réservées aux tests et ne sont pas incluses dans l’application.

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

Le portefeuille est pour l'instant un document JSONB privé versionné par ses relevés, associé au compte propriétaire. Les données de marché utilisent des tables séparées (voir ci-dessous) ; la normalisation complète des comptes/placements/relevés reste une évolution distincte. Les mises à jour du portefeuille sont atomiques. V1 personnelle : éviter l’édition simultanée sur plusieurs appareils (la dernière sauvegarde gagne). La synchronisation de base ne connaît que les symboles publics. Si le comparatif/Push est activé, GitHub Actions reçoit aussi les **poids relatifs et taux nécessaires**, mais jamais les montants en euros, noms des placements, objectifs ou historique. Aucun stockage local persistant des finances ; Supabase conserve la session d’authentification dans le navigateur. Se déconnecter sur un appareil partagé.

## Situation actuelle et historique mensuel

Le dashboard et les objectifs affichent les placements du dernier relevé détaillé disponible dans `portfolios.data.readings`, quelle que soit sa date. Le caractère projeté du point global ne masque pas les placements associés.

Seule la courbe utilise les totaux globaux datés du premier jour de chaque mois. Les détails plus récents restent visibles dans le dashboard sans ajouter de point quotidien à la courbe. Les montants sont relus toutes les 60 secondes et au retour sur la fenêtre ; les taux de marché toutes les 5 minutes.

## Calculs V1

- Gain annuel estimé = somme des montants × taux annuel / 100. Mensuel = annuel / 12.
- Les taux Actions et SCPI sont calculés depuis les placements détaillés. **JEQP est inclus** dans la moyenne pondérée Actions. Les taux de synthèse sont ignorés dès qu'une catégorie contient un placement en mode marché. Les autres taux de synthèse restent modifiables dans chaque relevé.
- ETF Monde : moyenne pondérée des performances WPEA/DCAM par leurs montants, pas moyenne simple.
- Rendement global = gain annuel estimé / capital détaillé.
- Total en tête = somme des derniers montants détaillés disponibles, indépendamment des totaux mensuels ; répartitions et estimations utilisent ces mêmes placements et les derniers taux de marché disponibles.
- Progression en cours = total actuel − dernier point mensuel réel validé de la courbe, sans utiliser les projections. Les apports/retraits ne sont pas isolés : ce n’est pas une performance financière nette des flux.
- Une projection ne devient jamais réelle automatiquement : modifier sa nature et valider le relevé à la clôture.

## Rendements automatiques sur 365 jours

### Source et méthode

Le fournisseur initial est **Yahoo Finance**, via son endpoint chart non officiel. Registre : WPEA.PA, DCAM.PA, PCEU.PA, PAEEM.PA, PAASI.PA et JEQP.L, ainsi que GLD et BTC-EUR pour l'or et le bitcoin. L'adaptateur est isolé dans `scripts/lib/yahoo.ts` pour permettre un remplacement par une API contractuelle. Yahoo peut changer son accès ou appliquer des quotas : ce service n'est pas garanti. Vérifier ses conditions pour l'usage personnel.

La synchronisation récupère deux ans de clôtures et utilise `adjusted_close`, ajusté des divisions et distributions selon Yahoo. Performance = `(clôture ajustée finale / clôture ajustée initiale − 1) × 100`, sans ajout de dividende manuel. Il s'agit d'une approximation de rendement total, distributions réinvesties, dépendante de la qualité fournisseur, pas d'un revenu encaissé ni d'une prévision.

- Fin : dernière clôture d'un jour strictement antérieur au jour UTC courant (exclusion des bougies intraday).
- Début : premier jour coté à partir de **la date de fin moins 365 jours**, au maximum 7 jours après la cible. Pas d'annualisation artificielle si l'historique est insuffisant.
- Un cours de clôture vieux de plus de 7 jours bloque le calcul.
- Devise vérifiée pour chaque instrument. JEQP.L est coté en **GBp** ; ne pas le remplacer par le JEPQ américain. Les pourcentages sont en devise de cotation : **pas de conversion de performance en EUR**, et pas d'effet de change ajouté au portefeuille. Les montants restent ceux saisis en euros.

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

### Activer la GitHub Action horaire

1. Générer localement un jeton aléatoire : `openssl rand -hex 32`. Ne pas le committer ni le mettre dans une variable `NEXT_PUBLIC_*`.
2. Dans le SQL Editor, enregistrer son empreinte (remplacer le texte par le jeton généré) :

```sql
insert into public.market_sync_secrets(singleton, token_sha256)
values(true, encode(sha256(convert_to('TON_JETON_ALEATOIRE', 'UTF8')), 'hex'))
on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
```

3. Dans GitHub → Settings → Secrets and variables → Actions, ajouter le **secret** `MARKET_SYNC_TOKEN` avec le même jeton. L'URL et la clé publique utilisent les deux variables déjà configurées pour le déploiement.
4. Pousser sur la branche par défaut. Dans Actions, lancer **Synchroniser les rendements de marché** manuellement pour amorcer les valeurs.
5. Le workflow `.github/workflows/sync-market.yml` tourne **toutes les heures de 08:00 à 20:00 incluses, heure française (`Europe/Paris`)**, y compris le week-end, avec changement d'heure été/hiver automatique : 13 synchronisations par jour. **Seul le déclenchement prévu à 10:00 peut envoyer une notification Push**. Les autres passages et les lancements manuels mettent à jour le comparatif sans notification. L’autorisation suit le déclenchement planifié, pas l’heure réelle du runner : un job de 09:00 retardé ne peut pas notifier à 10:00. GitHub peut retarder ou supprimer certaines exécutions en période de charge et désactiver les schedules des dépôts publics inactifs ; contrôler les journaux. L’heure de livraison exacte n’est pas garantie.

### Comportement dans l'application

Le dashboard lit les dernières performances depuis Supabase, au chargement puis toutes les cinq minutes, sans reconstruire le site. Un bouton relit les données stockées : il ne déclenche pas l'appel Yahoo. Chaque placement a un mode manuel ou marché et un regroupement facultatif dans Saisie. Le taux de marché est en lecture seule ; repasser en manuel permet un remplacement explicite.

Les taux automatiques du dashboard sont superposés à l'estimation courante, **sans réécriture des anciens relevés**. Lorsqu'un relevé nouveau ou explicitement modifié est enregistré, son taux connu et sa date de marché sont figés dans le relevé. Une modification des objectifs ne réactualise pas les anciens relevés. Une panne conserve la dernière performance valide et affiche un avertissement ; avant la première synchronisation, le taux du relevé sert de repli.

### Tester sans aucune écriture

```bash
npm run market:check
```

Pour une écriture locale, créer un fichier privé `.env.market` contenant `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `MARKET_SYNC_TOKEN`, puis exécuter `node --env-file=.env.market --import tsx scripts/sync-market.ts`. Les fichiers `.env*` sont ignorés par Git. Les journaux ne contiennent que des cotations publiques et performances, pas les positions ou secrets.

## Variation quotidienne et notifications Web Push

Après chaque job, la carte **Rendement global** peut afficher `9,52 % → 9,68 %`, puis `↗ +0,16 point`, « Variation aujourd’hui » (baisse en rouge, stabilité neutre). La référence est **la dernière observation enregistrée avant minuit, heure de Paris** ; elle reste fixe pour tous les jobs de la journée, quelle que soit leur fréquence. Au premier job du jour suivant, la dernière observation de la journée précédente devient la nouvelle référence. Si des jours sont sautés, la dernière observation disponible reste utilisée, avec sa date exacte dans l’infobulle. Un comparatif ancien affiche sa date plutôt qu’« aujourd’hui ».

C’est la variation quotidienne de l’**estimation annuelle pondérée**, pas un gain encaissé ni une performance intrajournalière du capital : la source Yahoo reste fondée sur les clôtures, même avec des jobs horaires. Les taux manuels restent inclus. Une édition pendant le job annule son enregistrement ; une édition ultérieure ne masque plus la variation. Les placements et taux de synthèse sont comparés à la référence pour signaler leurs modifications ; les objectifs ne font pas partie de cette comparaison. Une divergence entre rendement actuel et dernier comparatif est également signalée.

À l’initialisation, aucune variation n’est inventée : la première mesure sert à amorcer la référence pour la journée suivante. La carte affiche **Référence quotidienne en cours d’initialisation**, et aucune notification n’est envoyée sans référence antérieure.

### Configuration (une fois)

1. Exécuter `supabase/migrations/20261113085126_push_sync_impact.sql`, puis `supabase/migrations/20261113094822_daily_return_reference.sql` dans le SQL Editor, après les schémas précédents. Elles ajoutent les abonnements, le comparatif quotidien et la RPC `push_sync`. Les clients ne peuvent gérer que leurs abonnements et lire leur comparatif ; seul le jeton du job peut écrire un comparatif. Le schéma `financial_private` doit rester **non exposé** dans les paramètres Data API. Lors de la mise à niveau, l’ancienne dernière mesure est conservée pour amorcer la prochaine journée ; l’ancien delta par job n’est pas présenté comme une variation quotidienne. Déployer le nouveau script avec cette migration : l’ancien script ne demande pas d’envoi quotidien.
2. Générer un **nouveau jeton distinct** du jeton marché : `openssl rand -hex 32`. L'enregistrer comme secret GitHub **`PUSH_SYNC_TOKEN`**, puis enregistrer uniquement son empreinte dans Supabase :

```sql
insert into financial_private.push_sync_secrets(singleton, token_sha256)
values(true, encode(sha256(convert_to('TON_NOUVEAU_JETON', 'UTF8')), 'hex'))
on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
```

À ce stade, le **comparatif dans la carte fonctionne sans Web Push**. Sans `PUSH_SYNC_TOKEN`, le job continue à synchroniser le marché sans comparatif ni notification. `market:check` ne lit ni n'écrit les données privées.

3. Pour activer les notifications, générer localement une paire VAPID avec `npx web-push generate-vapid-keys`. Ne jamais committer la clé privée ni l'afficher dans les logs CI. Configurer dans GitHub → Settings → Secrets and variables → Actions :

| Type | Nom | Valeur |
|---|---|---|
| Variable | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Clé VAPID publique (la même pour le build et l'envoi) |
| Secret | `VAPID_PRIVATE_KEY` | Clé VAPID privée, jamais `NEXT_PUBLIC_*` |
| Variable | `VAPID_SUBJECT` | Contact réel, par exemple `mailto:toi@ton-domaine.fr` |

Pour le développement, mettre seulement la clé publique dans `.env.local`. Les secrets d'envoi peuvent être placés dans `.env.market` (ignoré par Git), jamais dans les variables publiques. Les exécutions locales sont silencieuses par défaut ; `PUSH_NOTIFICATIONS_ENABLED=true` autorise explicitement un test d’envoi. Dans Actions, cette variable est calculée automatiquement et vaut `true` uniquement pour le déclenchement prévu à 10:00. Garder la paire VAPID stable ; après rotation, désactiver puis réactiver les abonnements sur chaque appareil.

4. Redéployer la PWA pour intégrer la clé publique. Se connecter, puis cliquer **Activer les notifications** sur chaque appareil. Android/ordinateur : navigateur compatible ; iPhone/iPad : iOS/iPadOS 16.4+ et PWA ajoutée à l'écran d'accueil. L'autorisation n'est demandée qu'après ce clic. La désactivation ne concerne que l'appareil courant.
5. Déclencher manuellement **Synchroniser les rendements de marché** dans Actions pour initialiser le comparatif (sans envoi). Lors du passage prévu à **10:00**, avec une référence disponible, un changement du taux affiché produit une notification comme `🟢 9,52 % → 9,68 % ↗ / +0,16 point aujourd’hui · Estimation annuelle`, utilisant exactement la référence quotidienne de la carte. Aucun envoi si le taux n’a pas changé depuis la dernière notification. Les notifications système ne permettent pas de forcer la couleur du texte : pastilles et flèches remplacent le vert/rouge de la carte. Au clic, la PWA est ouverte au bon sous-chemin GitHub Pages.

### Comportement et confidentialité

- Au plus **une notification par abonnement et par jour, sur le job prévu à 10:00**, uniquement si le taux affiché à deux décimales diffère de la dernière notification réclamée pour envoi. Les autres passages n’avancent pas cette dernière valeur notifiée. Les jobs sans changement **conservent le delta quotidien**, sans nouvelle alerte. Un retour à la référence (zéro) peut être notifié après une variation. Un nouvel essai du même run GitHub ne renvoie pas la notification. La décision et la référence sont enregistrées atomiquement pour éviter les doublons entre jobs concurrents.
- Les erreurs de marché conservent les derniers taux valides. Un comparatif envoyé après un échec porte la mention **Synchronisation partielle**. Une erreur Push ne supprime pas les cours synchronisés mais fait échouer le job pour rester visible dans Actions.
- Les abonnements expirés (`404/410`) sont supprimés. Les autres erreurs ne sont pas retentées automatiquement. Un résultat déjà enregistré n'est pas renvoyé lors d'un nouvel essai du même run (priorité à l'absence de doublons plutôt qu'à une livraison garantie).
- La RPC vérifie un jeton dédié stocké uniquement sous forme d'empreinte ; pas de `service_role`. Elle ne peut pas modifier le portefeuille. Elle expose seulement les pondérations/taux nécessaires, les cours publics et, lors de l'enregistrement du résultat, les abonnements du propriétaire concerné. Ces données ne sont pas journalisées. Le script n'envoie qu'aux fournisseurs Push autorisés (Google, Mozilla, Apple, Windows).
- La notification affiche les **taux globaux sur l'écran verrouillé**, jamais les montants ni les positions. Le contenu est chiffré par Web Push. L'abonnement reste actif après déconnexion : sur un appareil partagé, **désactiver les notifications avant de se déconnecter**.
- Le comparatif est conservé dans Supabase, pas dans le navigateur. L'application relit le marché/comparatif toutes les cinq minutes et au retour sur la fenêtre.

Tests SQL : après le bootstrap et les schémas dans un PostgreSQL 17 **jetable**, exécuter les migrations Push et référence quotidienne, puis `tests/sql/push-security.sql` et `tests/sql/daily-reference.sql`. Ils couvrent RLS, jeton invalide, poids sans montants, version du portefeuille, doublons, nettoyage, initialisation, jobs successifs, retour à zéro, objectifs et placements modifiés, journées sautées et minuit à Paris. Ne jamais exécuter le bootstrap sur Supabase réel.

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
