/**
 * Module 1 - Scraping
 * Extrait des emails depuis Google (Serper) pour chaque query × domaine,
 * puis les stocke dans Supabase.
 */

import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { supabaseInsert, supabaseSelect } from '../utils/supabase.js';
import { filterValidContacts } from '../utils/millionverifier.js';
import { isFrenchText } from '../utils/french.js';
import { EMAIL_DOMAINS, AGENT_CONFIG } from '../config.js';

// Filtrage des faux emails (noms de fichiers média)
const MEDIA_EXTENSIONS = /\.(avif|jpeg|jpg|png|gif|webp|svg|bmp|tiff|ico|mp4|webm|mov|avi|mp3|wav|flac|pdf)$/i;
const FAKE_EMAILS = /noreply|exemple|example|test|no-reply|mydomain|mywebsite|mycompany|myorg|company|email|website|business|yourcompany|yourorg|yourbusiness|youremail|monemail|domain|zoominfo|partial-match|full-match|aplitrak.com|makesense.org|officeteam|shopify.com|talent.com|sentry.io|abuse/i;

dotenv.config();

// --- Constantes ---

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_API_URL = 'https://google.serper.dev/search';
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INPUT_FILE = path.resolve(process.cwd(), 'input.txt');

// --- Étape 1 : Extraction des queries ---

/**
 * Lit input.txt et retourne la liste des queries (1 par ligne, lignes vides ignorées).
 */
async function extractQueries(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

// --- Étape 2 : Recherche Serper et extraction des emails ---

/**
 * Pour une query × domaine, interroge Serper (Google) avec pagination
 * et extrait les emails trouvés dans les résultats.
 * Déduplication par email (insensible à la casse).
 */
async function extractSerpResultsEmails(searchStr, query, domain) {
  let start = 0;
  let pageNum = 1;
  const seenEmails = new Set();
  const contactsList = [];

  while (pageNum <= AGENT_CONFIG.PAGES_COUNT) {
    const response = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: searchStr,
        gl: 'fr',
        hl: 'fr',
        tbs: 'qdr:m',
        start
      })
    });

    if (!response.ok) {
      console.warn(`Erreur Serper (query: "${query}", start: ${start}): ${await response.text()}`);
      break;
    }

    const data = await response.json();
    const { organic = [] } = data;
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

    // Arrêt si plus de résultats ou aucun nouvel email sur cette page
    if (organic.length === 0 || newEmailsCount === 0) break;

    start += 10;
    pageNum++;
  }

  return contactsList;
}


// --- Étape 3a : Pré-filtre français (isFrenchText) ---
// --- Étape 3b : Vérification MillionVerifier ---

/**
 * Pré-filtre: isFrenchText (utils/french.js) - garde les contacts avec texte français.
 * Puis filterValidContacts (utils/millionverifier.js) - ok, catch_all, unknown.
 */

// --- Étape 4 : Stockage Supabase ---

/**
 * Insère les contacts dans Supabase (table "contacts").
 * Ignore les emails déjà présents en base.
 * @returns Nombre d'emails effectivement insérés
 */
async function storeContacts(contacts, source_query) {
  let inserted = 0;

  for (const contact of contacts) {
    const exist = await supabaseSelect('contacts', 'email', contact.email, 1);

    if (!exist || exist.length === 0) {
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
    }
  }

  return inserted;
}

// --- Exécution principale ---

(async function main() {
  const queries = await extractQueries(INPUT_FILE);
  let totalExtracted = 0;
  let totalFrench = 0;
  let totalVerified = 0;
  let totalInserted = 0;

  for (const query of queries) {
    console.log(`\n--- Query: "${query}" ---\n`);

    // Recherche séquentielle par domaine (rate limit Serper: 5 req/s)
    const resultsArrays = [];

    for (const domain of EMAIL_DOMAINS) {
      const searchStr = `"${query}" "${domain}"`;
      const contacts = await extractSerpResultsEmails(searchStr, query, domain);
      resultsArrays.push(contacts);
    }

    // Fusion et déduplication entre domaines
    const seen = new Set();
    const contacts = resultsArrays.flat().filter(c => {
      const email = c.email.toLowerCase();
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });

    totalExtracted += contacts.length;

    if (contacts.length > 0) {
      // Pré-filtre français (économie crédits MillionVerifier + temps)
      const frenchContacts = contacts.filter(c =>
        isFrenchText([c.title, c.description].filter(Boolean).join(' '))
      );
      const rejectedFrench = contacts.length - frenchContacts.length;
      totalFrench += frenchContacts.length;

      // Étape 3b : Vérification MillionVerifier (ok + catch_all + unknown)
      const verifiedContacts = frenchContacts.length > 0
        ? await filterValidContacts(frenchContacts)
        : [];
      const rejectedMv = frenchContacts.length - verifiedContacts.length;

      totalVerified += verifiedContacts.length;

      if (verifiedContacts.length > 0) {
        const inserted = await storeContacts(verifiedContacts, query);
        totalInserted += inserted;
        console.log(`Extraits: ${contacts.length} | Français: ${frenchContacts.length} | Vérifiés: ${verifiedContacts.length} | Insérés: ${inserted}`);
      } else {
        console.log(`Extraits: ${contacts.length} | Français: ${frenchContacts.length} | Vérifiés: 0 | Rejetés: ${rejectedMv}`);
      }
    }
  }

  // Récap final
  console.log('\n--- Récap final ---');
  console.log(`Queries traitées: ${queries.length}`);
  console.log(`Emails extraits (total): ${totalExtracted}`);
  console.log(`Emails français (total): ${totalFrench}`);
  console.log(`Emails validés (total): ${totalVerified}`);
  console.log(`Emails insérés (total): ${totalInserted}`);
  console.log('Scraping terminé.');
})();
