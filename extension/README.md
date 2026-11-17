# Boursosync → FinancIAl

Extension Chrome Manifest V3, JavaScript natif sans build. Lecture automatique à l’ouverture du popup avec `activeTab`/`scripting`, sans page de réglages. Google Sheets et les sélecteurs configurables sont remplacés par une lecture des titres par ISIN, des soldes personnels dans la sidebar et une RPC Supabase.

## Installation

1. Côté développement : appliquer les migrations Boursosync, `*_remove_boursosync_cash.sql`, puis `*_boursosync_extension_only.sql`. Conserver `financial_private` **non exposé** dans la Data API. Lancer `npm run extension:prepare` (également exécuté avant `dev` et `build`) : `project.json` contient uniquement l’URL Supabase, sa clé publique et les alias ISIN, jamais de secret. Le manifeste est préparé avec l’autorisation réseau du **seul projet configuré**, sans wildcard.
2. Dans Chrome → `chrome://extensions`, activer le mode développeur, « Charger l’extension non empaquetée », sélectionner **ce dossier `extension/`**, pas la racine Next.js.
3. Accepter si nécessaire l’autorisation du projet Supabase lors du chargement ou de la mise à jour de l’extension. Ouvrir ensuite le popup, puis **Se connecter à FinancIAl** avec les identifiants de l’application, jamais ceux de la banque. Aucune demande d’autorisation ne s’ouvre après la saisie des identifiants. Si l’accès est retiré dans Chrome, le formulaire reste masqué jusqu’à sa réactivation dans les détails de l’extension.
4. Se connecter normalement à BoursoBank et ouvrir le PEA → Positions → **Position instantanée**, ou les positions au comptant du CTO. **Ouvrir le popup : la page et les soldes personnels de la sidebar sont lus automatiquement**, également juste après la première connexion FinancIAl. Le Livret A et l’assurance vie sont aussi lisibles sur une autre page affichant cette sidebar. Aucun bouton de lecture ou d’effacement.
5. Vérifier les montants et les destinations reconnues par **ISIN + enveloppe** pour les titres. Le Livret A personnel est reconnu vers une destination unique nommée « Livret A », sans code, en enveloppe Direct. Le total d’assurance vie est proposé uniquement s’il existe une seule destination sans code dans cette enveloppe ; vérifier qu’elle représente le contrat entier. Pour les autres cas, choisir un placement existant ou **Ignorer cette ligne**, directement dans le popup.
6. Cliquer **Confirmer la synchronisation**, en haut de l’aperçu. Les associations et montants sont enregistrés ensemble, sans autre manipulation dans FinancIAl. L’ouverture du popup ne déclenche jamais cet envoi.

Le jeton dédié expire après 180 jours. Une nouvelle connexion le renouvelle et invalide l’ancien. **Déconnecter l’extension** révoque cet accès. Aucun panneau Boursosync n’est présent dans le site.

Aucun export/import de fichiers n’est nécessaire. `project.json` est ignoré par Git : le préparer avant de distribuer le dossier de l’extension.

L’enveloppe et la classe d’actifs sont distinctes : Obligations, Or et Bitcoin peuvent être détenus en CTO sans devenir des Actions. Pour les titres, le rapprochement exige l’ISIN exact et la bonne enveloppe, jamais un nom, une classe d’actifs ou un proxy (bitcoin spot, autre produit or). Aucun repli de CTO vers « Direct » ; une erreur d’enveloppe doit être corrigée dans les données. Les doublons et destinations déjà occupées restent protégés.

## Périmètre des lecteurs

- **PEA** : lecteur basé sur la structure HTML fournie, ISIN par ligne, colonne `amount` identifiée par son lien d’en-tête. Les publicités sont ignorées ; une ligne inconnue ou ambiguë bloque la capture.
- **CTO** : tableau « Positions au comptant » (`/compte/ord/.../positions`), lecture par ISIN et colonne exacte `amount`, testée sur la structure fournie. L’identité du compte est recoupée avec l’URL à partir de `data-account-key` ou des attributs de compte des contrôles du tableau, jamais en activant ces contrôles. Une contradiction bloque toute capture. Les engagements en liquidation ne sont pas importés. La vérification dans le navigateur bancaire réel reste nécessaire.
- **Livret A / assurance vie personnels** : lecture de la sidebar `accounts-perso`, sections exactes « Mon épargne » et « Mes placements financiers ». Les URL des comptes sont recoupées avec `data-account-label` ; seuls les soldes chargés et valides sont lus, sous la source `balance`, avec une empreinte distincte par compte. Des copies identiques de la sidebar sont dédupliquées ; une contradiction bloque la capture. La section « Comptes de mes enfants », les autres segments, comptes courants, crédits, cartes et totaux globaux sont ignorés. Aucun sélecteur CSS ni page de réglages.
- Les espèces du PEA/CTO ne sont pas capturées ni synchronisées. Seuls les montants des titres sont importés depuis ces tableaux.
- Pour l’assurance-vie multisupport, le montant de la sidebar est **le total du contrat**, pas le fonds euros seul. Un avertissement est toujours affiché. Si FinancIAl détaille plusieurs supports, ne pas confirmer ce total vers un seul support : ignorer la ligne. Le total peut être confirmé si le placement représente le contrat entier, notamment un contrat entièrement en fonds euros.
- WPEA/DCAM restent deux sources distinctes. Leur regroupement « ETF Monde » est uniquement visuel dans FinancIAl.

Importer les montants affichés, jamais quantité × cours (arrondis), ni les plus-values latentes comme taux annuels.

## Sécurité et conservation

- Aucun cookie, mot de passe, stockage bancaire, script de page ou jeton BoursoBank n’est lu. Aucun appel à son API privée et aucune action sur les boutons d’achat/vente.
- L’injection est limitée à l’onglet actif sur `https://clients.boursobank.com`, après clic utilisateur, dans le monde isolé de Chrome.
- La référence de compte est hachée localement (SHA-256) ; ce pseudonyme reste une donnée privée, pas une anonymisation garantie.
- Connexion Supabase temporaire en mémoire : ni mot de passe, JWT ni refresh token sauvegardé. Déconnexion de cette seule session temporaire demandée après création de la capacité ; si le réseau coupe, son JWT reste valide jusqu’à expiration mais n’est pas conservé.
- Jeton dédié dans `chrome.storage.local`, accessible aux seuls contextes de l’extension ; jamais `chrome.storage.sync`, journaux ou code. Il permet uniquement de lire un catalogue (identifiants, noms, codes, enveloppes et associations, **sans montants ni taux**), de synchroniser les montants confirmés et de révoquer son propre accès. Il ne permet pas de lire le document du portefeuille ni de modifier les objectifs, taux ou relevés historiques.
- Captures en `chrome.storage.session` uniquement, expirant après 30 minutes (nettoyage périodique et contrôle lors de chaque envoi). Elles sont effacées après une synchronisation confirmée, lors de la déconnexion ou à la fermeture du navigateur. Aucune capture n’est stockée dans le site.
- Les erreurs HTTP ne sont pas affichées brutes. Un envoi sans réponse peut être réessayé avec le même identifiant, sans double écriture.
- Si la synthèse « Évaluation titres » est présente, elle est comparée à la somme des lignes : blocage si l’écart dépasse **1 € ou 0,1 %**, le plus grand des deux. Les petits écarts sont signalés car les cours peuvent évoluer séparément. Elle reste obligatoire sur le PEA. Sur le CTO, son absence autorise la lecture du tableau avec un avertissement explicite : vérifier chaque ligne avant confirmation ; le total du compte (qui peut inclure des espèces) n’est jamais utilisé comme total des titres.
- Chaque lecture complète remplace les captures en attente des seuls comptes effectivement relus. Les titres disparus sont retirés de l’aperçu et du prochain lot ; les captures des autres comptes restent disponibles. Un compte dont le tableau est vide et la synthèse « Évaluation titres » vaut explicitement zéro retire ses anciennes captures, sans produire de lignes à zéro. Une lecture invalide ou plus ancienne ne supprime pas une capture plus récente.
- Les positions absentes ne sont jamais mises à zéro dans FinancIAl. Les montants nuls réellement lus sur une ligne sont acceptés.
- Le serveur refuse les captures périmées, antérieures à celles déjà appliquées, ou antérieures à une saisie manuelle plus récente. En cas de refus, relire la page.
- La confirmation porte sur le lot complet ; une ligne invalide annule toutes ses mises à jour.

## Vérifications

Depuis la racine :

```bash
npm test
npm run typecheck
npm run build
npm run test:boursosync:db
```

Le dernier test utilise Docker et un PostgreSQL **jetable sans réseau**, jamais la base Supabase partagée. Les fragments HTML des tests reproduisent uniquement la structure DOM : noms de compte, références, quantités, prix, soldes et montants sont synthétiques. Les ISIN publics servent à vérifier l’identification des instruments. Ces fixtures ne sont pas une démonstration de portefeuille réel.

La recette bancaire réelle reste à faire après installation : lecture seule, contrôle de l’aperçu, puis premier envoi volontaire après validation. Ne pas copier le HTML complet d’une page connectée : il peut contenir des jetons de session.

## Versionnement et déploiement

Le protocole est en version `1`, l’extension en version `3.2.2`. Version inconnue = refus, sans écriture. JavaScript natif sans bundler ; seules la configuration publique et l’autorisation réseau ciblée du manifeste sont préparées depuis l’environnement du projet.

Les icônes PNG 16/32/48/128 px dans `icons/` reprennent la feuille de `public/icons/source.svg`, recadrée sur le carré vert pour rester lisible dans la barre d’outils Chrome.

Les appels réseau et la confirmation sont exécutés depuis le popup. S’il est fermé pendant l’envoi, la réponse peut être perdue : à la réouverture, l’aperçu et l’identifiant du lot en attente sont conservés au lieu d’être remplacés par une nouvelle capture. Cliquer de nouveau sur la confirmation permet de réessayer sans double écriture. Sinon, chaque ouverture sur un compte bancaire lance une nouvelle lecture ; sur un autre site, aucun script bancaire n’est injecté.
