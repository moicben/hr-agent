# AGENTS.md

## Cursor Cloud specific instructions

### Aperçu du projet

HR Agent est un pipeline Node.js (ES Modules) de prospection email en 3 étapes : **scraper** → **verifier** → **sender**. Chaque module s'exécute avec `node modules/<module>.js` ou via `./run.sh` pour le pipeline complet.

### Services et API

| Service | Variable d'env | Rôle |
|---|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_KEY` | Base de données (tables: `contacts`, `emails`, `identities`) |
| SearXNG | `SEARXNG_BASE_URL` (défaut: `http://localhost:8080`) | Méta-moteur de recherche pour le scraper |
| Resend | `RESEND_API_KEY` | Envoi d'emails (sender) |
| MillionVerifier | `MILLIONVERIFIER_API_KEY` | Vérification d'emails (verifier) |
| Serper.dev | `SERPER_API_KEY` | Alternative à SearXNG (non utilisé dans le pipeline principal) |

### Exécution des modules

- Les modules ont une IIFE `(async function main() { ... })()` qui s'exécute à l'import. Pour tester des fonctions exportées sans déclencher le pipeline, utilisez des imports dynamiques ciblés (ex: `import { isFrenchText } from './utils/french.js'`).
- Le scraper nécessite SearXNG en local (port 8080). Sans SearXNG, ce module échoue immédiatement.
- La vérification LLM (étape 3 du verifier) est **commentée** dans le code actuel.

### Pas de lint / test configuré

Il n'y a pas de configuration ESLint, Prettier ni de fichiers de test. Playwright est une devDependency mais aucun test Playwright n'existe dans le dépôt. La vérification syntaxique se fait via `node -e "import('./module.js')"`.
