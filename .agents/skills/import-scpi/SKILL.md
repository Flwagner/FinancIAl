---
name: Import portefeuille SCPI
description: Actualiser ou importer le portefeuille SCPI depuis le MCP Louve Invest dans FinancIAl/Supabase, sur demande manuelle notamment semestrielle, en préservant les dérogations manuelles et sans modifier Louve.
---

## Objectif et périmètre

Synchroniser les SCPI de l'utilisateur connecté à Louve avec son portefeuille FinancIAl. Une invocation suffit, aucun besoin de redéfinir le processus. Lire d'abord `AGENTS.md` à la racine et les modules `src/lib/scpi.ts` et `src/lib/scpi-normalize.ts` (chemins depuis la racine du dépôt).

- Source : MCP `louveinvest`, exclusivement en lecture. Ne jamais appeler ses outils d'ajout/modification/suppression, ni créer de simulation.
- Destination : section `scpi` du document `public.portfolios.data`, protégée par les RLS existantes. L'application sauvegarde tout le document atomiquement via `save_portfolio_checked` (comparaison de version). Ne pas ajouter de clé de service ni contourner cette sauvegarde par du SQL.
- Pas d'automatisation planifiée : l'utilisateur déclenche le skill, généralement deux fois par an.
- Ne rien écrire en base avant présentation des écarts et confirmation explicite. Une demande d'aperçu n'autorise jamais une écriture.
- Ne jamais versionner des réponses MCP, fichiers d'import, identifiants ou jetons. Utiliser un répertoire privé unique sous `/tmp/opencode` avec fichiers mode 0600.

## 1. Collecte complète

Découvrir les signatures actuelles des outils via la recherche de catalogue, sans les deviner.

1. `get_portfolio` avec `includeExternal: true`.
2. `list_transactions` avec `includeExternal: true`, `pageSize: 50`, toutes les pages jusqu'à `hasMore: false`. Vérifier le total. Ne pas omettre les SCPI vendues ni assimiler une vente en cours à une vente exécutée.
3. `get_scpi` pour chaque `scpiUrlId` détenu. Pas de recherche approximative si l'identifiant exact est disponible.
4. Conserver fidèlement les réponses JSON dans un bundle privé de forme `{ portfolio, facts: [...], transactionPages: [...] }`. Si le transport MCP enveloppe les données, déballer le JSON sans inventer de valeurs.
5. Ne pas importer un résultat incomplet. Si le compte Louve ne correspond pas au compte FinancIAl attendu, s'arrêter et demander confirmation.

## 2. Préparer

Depuis la racine :

```sh
npx tsx scripts/prepare-scpi-import.ts /tmp/opencode/<dossier-prive>/bundle.json /tmp/opencode/<dossier-prive>/import.json
```

Le script valide les totaux et la pagination, convertit les taux 0–1 en pourcentages pour la saisie, et évite le double comptage France/régions. Pour le taux : prendre en priorité `performanceHistory` FY de N−1 ; si son champ `distributionRate` est absent (ou si la ligne FY manque), utiliser `distributionRate` de la fiche générale. Ce repli est marqué `rateReference: "general"` sans inventer d'année (`rateYear` absent) et doit être signalé dans l'aperçu. Un taux annuel à zéro est une valeur valide, pas une absence. Ne jamais additionner FY et trimestres, ni utiliser une performance trimestrielle comme un taux annuel. Si les deux sources manquent, conserver le taux manuel antérieur lorsqu'il existe ; sinon signaler l'indisponibilité. Les règles de démembrement restent applicables.

Un champ absent reste absent. La date de collecte n'est pas la date d'arrêté des répartitions. Les prix de retrait sont indicatifs, pas une promesse de liquidité. Les taux sont des références, pas les revenus réellement encaissés.

## 3. Aperçu dans l'application

Utiliser exclusivement le MCP Playwright, sur `http://localhost:3000`, et la session existante. Démarrer le serveur si nécessaire. Pour une connexion nécessaire, suivre AGENTS.md : identifiants uniquement dans le formulaire, jamais affichés ni copiés ailleurs.

1. Lire Vue d'ensemble et Portefeuille SCPI pour contrôler les positions existantes et le compte connecté.
2. Dans Portefeuille SCPI, utiliser l'entrée technique masquée `input[aria-label="Import technique SCPI"]`. Aucun bloc d'import manuel n'est affiché sur la page.
3. Charger le fichier JSON avec Playwright `page.locator('input[aria-label="Import technique SCPI"]').setInputFiles(cheminDuFichier)` via l'outil d'exécution Playwright. Une entrée fichier masquée accepte `setInputFiles` sans être rendue visible. Ceci prépare l'aperçu de confirmation, sans écriture.
4. Relever les erreurs de rapprochement. Ne pas supprimer une ligne ni fusionner des placements pour les contourner. Si un ancien nom diffère, sélectionner la ligne existante dans « Rapprocher <SCPI> » et inclure ce rapprochement dans le récapitulatif à confirmer. **Conserver le libellé FinancIAl de toute ligne existante** ; ajouter l'identifiant Louve `scpiId` pour stabiliser les prochains imports, sans doublon ni renommage. Une nouvelle ligne sans équivalent prend le libellé Louve. En cas d'ambiguïté demander à l'utilisateur, ne pas deviner ni inventer de transaction.
5. Présenter les écarts de capital, les taux N−1, les positions et transactions en cours, les données manquantes et les dérogations manuelles conservées. Demander confirmation avant de cliquer « Confirmer l’import SCPI ».

Une source commune pilote le montant ET le taux SCPI : **Louve Invest** ou **Manuel**, dans la colonne Source après Montant et Taux annuel. Les deux champs techniques `amountSource` et `rateSource` sont conservés pour compatibilité mais doivent rester alignés sur les nouvelles lignes. Si une ancienne ligne liée contient une source manuelle pour l'une des valeurs, préserver les DEUX valeurs et les passer en mode manuel. Au premier rapprochement d'une ancienne ligne non liée, un taux manuel identique au taux Louve peut adopter la source Louve sans changer sa valeur ; s'il diffère, conserver les DEUX valeurs en manuel. Un choix Manuel explicite sur une ligne associée n'est jamais écrasé. Choisir « Louve Invest » dans la colonne Source rétablit simultanément le montant et le taux du dernier import.

## 4. Enregistrement et vérification

Après confirmation seulement, cliquer « Confirmer l’import SCPI ». Vérifier le succès puis recharger l'application : l'instantané et les chiffres doivent persister. L'import identique est un no-op ; un import différent du même jour est bloqué (ne jamais antidater pour contourner ce contrôle). Un import plus ancien est refusé.

Vérifier via l'interface le capital SCPI, les répartitions, les taux et dérogations, puis Vue d'ensemble et Portefeuille boursier. Relever les chiffres et joindre une capture Playwright. Ne faire aucune autre écriture lors de cette recette.

Rapporter : date, nombre de SCPI/transactions, montants avant/après, dérogations conservées, avertissements, vérification après rechargement. Supprimer uniquement les fichiers privés créés pour cet import après succès ; en cas d'échec, indiquer qu'ils restent locaux sans exposer leur contenu.
