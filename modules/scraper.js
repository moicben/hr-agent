/**
 * Module 1 - Scraping
 * Extrait des emails via SearXNG pour chaque query × domaine,
 * puis les stocke dans Supabase.
 */

import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { supabaseInsert, supabaseSelect } from '../utils/supabase.js';
import { searchSearxng } from '../utils/searxng.js';
import { EMAIL_DOMAINS, AGENT_CONFIG } from '../config.js';

// Filtrage des faux emails (noms de fichiers média)
const MEDIA_EXTENSIONS = /\.(avif|jpeg|jpg|png|gif|webp|svg|bmp|tiff|ico|mp4|webm|mov|avi|mp3|wav|flac|pdf)$/i;
const FAKE_EMAILS = /noreply|exemple|example|test|no-reply|mydomain|mywebsite|mycompany|myorg|company|email|website|business|yourcompany|yourorg|yourbusiness|youremail|monemail|domain|zoominfo|partial-match|full-match|aplitrak.com|makesense.org|officeteam|shopify.com|talent.com|sentry.io|abuse/i;

dotenv.config();

// --- Constantes ---

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INPUT_FILE = path.resolve(process.cwd(), 'input.txt');
const HISTORIC_FILE = path.resolve(process.cwd(), 'input_historic.txt');

// --- Étape 1 : Extraction des queries ---

/**
 * Lit input.txt et retourne la liste des queries (1 par ligne, lignes vides ignorées).
 */
export async function extractQueries(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export async function waitRandomRequestDelay() {
  const minDelay = AGENT_CONFIG.REQUEST_DELAY_MIN_MS ?? 1000;
  const maxDelay = AGENT_CONFIG.REQUEST_DELAY_MAX_MS ?? 5000;
  const delayMs = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// --- Étape 2 : Recherche SearXNG et extraction des emails ---

/**
 * Pour une query × domaine, interroge SearXNG avec pagination
 * et extrait les emails trouvés dans les résultats.
 * Déduplication par email (insensible à la casse).
 */
export async function extractSerpResultsEmails(searchStr, query, domain) {
  let pageNum = 1;
  const seenEmails = new Set();
  const contactsList = [];

  while (pageNum <= AGENT_CONFIG.PAGES_COUNT) {
    let organic = [];
    try {
      organic = await searchSearxng({
        query: searchStr,
        page: pageNum,
        language: 'fr-FR'
      });
    } catch (error) {
      console.error(`[SearXNG] Indisponible (query: "${query}", page: ${pageNum}): ${error?.message || error}`);
      throw error;
    }

    await waitRandomRequestDelay();

    let newEmailsCount = 0;

    for (const result of organic) {
      const { title, link, snippet } = result;
      const allFields = [title, snippet, link].join(' ');
      const emails = allFields.match(EMAIL_REGEX) || [];

      emails.forEach(email => {
        const normalized = email.toLowerCase();
        if (MEDIA_EXTENSIONS.test(normalized)) return;
        if (FAKE_EMAILS.test(normalized)) return;

        if (!seenEmails.has(normalized)) {
          seenEmails.add(normalized);
          newEmailsCount++;
          contactsList.push({
            email: normalized,
            title,
            description: snippet,
            url: link
          });
        }
      });
    }

    console.log(`Extraits: ${newEmailsCount} | page: ${pageNum} | domain: ${domain}`);

    // Arrêt si 0 ou 1 résultat, ou aucun nouvel email sur cette page
    if (organic.length <= 1 || newEmailsCount === 0) break;

    pageNum++;
  }

  return contactsList;
}


// --- Étape 3 : Stockage dans Supabase ---

/**
 * Insère les contacts dans Supabase (table "contacts"), status "new"
 * Ignore les emails déjà présents en base ou les contacts déjà traités.
 * additional_data : title, description, url.
 * @returns Nombre d'emails effectivement insérés
 */
export async function storeContacts(contacts, source_query) {
  let inserted = 0;

  for (const contact of contacts) {
    const exist = await supabaseSelect('contacts', 'email', contact.email, 1);

    if (!exist || exist.length === 0) {
      try {
        await supabaseInsert('contacts', {
          email: contact.email,
          source_query,
          additional_data: {
            title: contact.title,
            description: contact.description,
            url: contact.url
          },
          status: 'new'
        });
        inserted++;
      } catch (err) {
        // Doublon ou autre erreur : on ignore et continue
        if (err?.code !== '23505') console.error('[storeContacts]', err?.message || err);
      }
    }
  }

  return inserted;
}


// --- Étape 4 : Déplacement des queries traitées ---

/**
 * Déplace une query traitée de input.txt vers le haut de input_historic.txt.
 */
export async function moveQueryToHistoric(query) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;

  const inputContent = await fs.readFile(INPUT_FILE, 'utf8');
  const inputLines = inputContent.split('\n');
  const queryIndex = inputLines.findIndex(line => line.trim() === normalizedQuery);

  if (queryIndex !== -1) {
    inputLines.splice(queryIndex, 1);
    await fs.writeFile(INPUT_FILE, inputLines.join('\n').replace(/\n+$/, '\n'), 'utf8');
  }

  let historicContent = '';
  try {
    historicContent = await fs.readFile(HISTORIC_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const historicLines = historicContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line !== normalizedQuery);

  const newHistoricContent = [normalizedQuery, ...historicLines].join('\n');
  await fs.writeFile(HISTORIC_FILE, `${newHistoricContent}\n`, 'utf8');
}

// --- Exécution principale ---

(async function main() {
  const queries = await extractQueries(INPUT_FILE);
  let totalExtracted = 0;
  let totalInserted = 0;

  // Boucle principale de scraping ---
  for (const query of queries) {
    console.log(`\n--- Query: "${query}" ---\n`);

    // Extraction des emails via SearXNG ---
    const resultsArrays = [];
    for (const domain of EMAIL_DOMAINS) {
      const searchStr = `"${query}" ("${domain}")`;
      const contacts = await extractSerpResultsEmails(searchStr, query, domain);
      resultsArrays.push(contacts);
    }

    // Déduplication des emails ---
    const seen = new Set();
    const contacts = resultsArrays.flat().filter(c => {
      const email = c.email.toLowerCase();
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });
    
    // Stockage des contacts dans Supabase ---
    totalExtracted += contacts.length;

    if (contacts.length > 0) {
      const inserted = await storeContacts(contacts, query);
      totalInserted += inserted;
      console.log(`Extraits: ${contacts.length} | Insérés: ${inserted}`);
    }

    // Déplacement de la query traitée vers le haut de input_historic.txt ---
    await moveQueryToHistoric(query);
  }

  // Récapitulation des résultats ---
  console.log('\n--- Récap final ---');
  console.log(`Queries traitées: ${queries.length}`);
  console.log(`Emails extraits (total): ${totalExtracted}`);
  console.log(`Emails insérés (total): ${totalInserted}`);
  console.log('Scraping terminé.');

  // Gestion des erreurs ---
})().catch(err => {
  console.error('Erreur fatale:', err?.message || err);
  process.exit(1);
});
