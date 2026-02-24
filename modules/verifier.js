/**
 * Module Verifier
 * Pour chaque contact avec status "new", lance :
 * - Étape 1 : filtre français (isFrenchText sur titre + description)
 * - Étape 2 : MillionVerifier (ok, catch_all)
 * - Étape 3 : vérification d'intérêt LLM (indépendant ouvert à une potentielle mission ?)
 * Les contacts qui passent les 3 étapes → status "verified", les autres → status "rejected".
 */

import 'dotenv/config';
import { supabaseClient, supabaseUpdate } from '../utils/supabase.js';
import { filterValidContacts } from '../utils/millionverifier.js';
import { isFrenchText } from '../utils/french.js';
import { localLlmRequest } from '../utils/llm.js';
import { AGENT_CONFIG, VERIFIER_PROMPT } from '../config.js';

/** Taille des pages pour contourner la limite Supabase/PostgREST (défaut 1000 lignes). */
const FETCH_PAGE_SIZE = 1000;

/**
 * Récupère les contacts avec status "new" et email non null (limité par CONTACTS_TO_VERIFY, "*" = sans limite).
 * Pagine automatiquement pour récupérer au-delà de la limite 1000 de Supabase.
 */
async function getNewContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_VERIFY ?? 100;
  const hasLimit = limitRaw !== '*';
  const maxTotal = hasLimit ? Math.min(Number(limitRaw), 1e6) : 1e6;
  const all = [];

  let offset = 0;
  let hasMore = true;

  while (hasMore && all.length < maxTotal) {
    const pageSize = Math.min(FETCH_PAGE_SIZE, maxTotal - all.length);
    const from = offset;
    const to = offset + pageSize - 1;

    const { data, error } = await supabaseClient
      .from('contacts')
      .select('*')
      .eq('status', 'new')
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('[verifier] Erreur Supabase:', error.message);
      throw error;
    }

    const page = data || [];
    all.push(...page);
    offset += page.length;
    hasMore = page.length === FETCH_PAGE_SIZE;
  }

  return all;
}

/**
 * 1. Titre et description sont en français ? (isFrenchText).
 */
function filterFrenchContacts(contacts) {
  return contacts.filter(c => {
    const add = c.additional_data || {};
    const text = [add.title, add.description].filter(Boolean).join(' ');
    return isFrenchText(text);
  });
}

/**
 * 2. MillionVerifier : Les emails sont valides ? (ok, catch_all).
 */
async function verifyContacts(contacts) {
  if (contacts.length === 0) return [];
  return filterValidContacts(contacts);
}

/**
 * 3. Intérêt LLM : ce contact est-il un indépendant en potentiel recherche de missions ?
 * Retourne { hasInterest: boolean, explanation?: string }. Parse "true" ou "false: explication".
 */
async function verifyContactInterest(contact) {
  const payload = {
    email: contact.email,
    source_query: contact.source_query,
    additional_data: contact.additional_data || {}
  };
  const contactInformations = JSON.stringify(payload, null, 2);
  const systemPrompt = VERIFIER_PROMPT[0].system;
  const userPrompt = VERIFIER_PROMPT[0].user.replace(/\{\{contact_informations\}\}/g, contactInformations);
  const raw = await localLlmRequest(systemPrompt, userPrompt, 0.5, 100);
  const trimmed = String(raw).trim();
  const hasInterest = /^true$/i.test(trimmed);
  const explanation = hasInterest ? null : (trimmed.replace(/^false\s*:?\s*/i, '').trim() || null);
  return { hasInterest, explanation };
}

/**
 * 4. Met à jour le status et la note du contact en base.
 * @param {string} note - Raison et explication (pour rejet). Null si verified.
 */
async function setContactStatus(contactId, status, note = null) {
  const data = { status };
  if (note) data.note = note;
  await supabaseUpdate('contacts', 'id', contactId, data);
}

// --- Exécution principale ---

(async function main() {
  const contacts = await getNewContacts();
  console.log('\n--- Vérification ---\n');
  console.log(`Contacts status "new" à traiter: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_VERIFY === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_VERIFY})`);

  if (contacts.length === 0) {
    console.log('Aucun contact à vérifier. Terminé.');
    return;
  }

  let verified = 0;
  let rejected = 0;
  let failed = 0;
  let rejectedFrench = 0;
  let rejectedMv = 0;
  let rejectedInterest = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;
    try {
      console.log(`${progress} --- Contact: ${contact.email} ---`);

      // Étape 1: filtre français
      const isFrench = filterFrenchContacts([contact]).length > 0;
      if (!isFrench) {
        rejectedFrench++;
        await setContactStatus(contact.id, 'rejected', 'Rejeté: Titre et description non français.');
        rejected++;
        console.log(`${progress} Rejeté (étape 1: français)\n`);
        continue;
      }

      // Étape 2: validation MillionVerifier
      const mvValidated = (await verifyContacts([contact])).length > 0;
      if (!mvValidated) {
        rejectedMv++;
        await setContactStatus(contact.id, 'rejected', 'Rejeté: Email invalide ou non vérifié (MillionVerifier).');
        rejected++;
        console.log(`${progress} Rejeté (étape 2: MillionVerifier)\n`);
        continue;
      }

      // Étape 3: intérêt LLM (désactivé temporairement)
      // const { hasInterest, explanation } = await verifyContactInterest(contact);
      // if (!hasInterest) {
      //   rejectedInterest++;
      //   const note = explanation
      //     ? `Rejeté: Pas d'intérêt pour missions. ${explanation}`
      //     : 'Rejeté: Pas d\'intérêt pour missions (vérification LLM).';
      //   await setContactStatus(contact.id, 'rejected', note);
      //   rejected++;
      //   console.log(`${progress} Rejeté (étape 3: intérêt)\n`);
      //   continue;
      // }

      await setContactStatus(contact.id, 'verified');
      verified++;
      console.log(`${progress} OK (verified)\n`);
    } catch (err) {
      failed++;
      console.error(`${progress} Erreur: ${err.message}\n`);
      console.error(`[verifier] Échec mise à jour ${contact.email}: ${err.message}`);
    }
  }

  console.log('\n--- Récap ---');
  console.log(`Traités: ${contacts.length} | Verified: ${verified} | Rejected: ${rejected}${failed > 0 ? ` | Échecs: ${failed}` : ''}`);
  console.log(`  → Rejetés (français): ${rejectedFrench} | Rejetés (MillionVerifier): ${rejectedMv} | Rejetés (intérêt): ${rejectedInterest}`);
  console.log('Vérification terminée.');
})();
