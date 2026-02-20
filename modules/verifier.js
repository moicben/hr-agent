/**
 * Module Verifier
 * Pour chaque contact avec status "new", lance :
 * - Étape 1 : filtre français (isFrenchText sur titre + description)
 * - Étape 2 : MillionVerifier (ok, catch_all, unknown)
 * - Étape 3 : vérification d'intérêt LLM (indépendant ouvert à une potentielle mission ?)
 * Les contacts qui passent les 3 étapes → status "verified", les autres → status "rejected".
 */

import 'dotenv/config';
import { supabaseClient, supabaseUpdate } from '../utils/supabase.js';
import { filterValidContacts } from '../utils/millionverifier.js';
import { isFrenchText } from '../utils/french.js';
import { localLlmRequest } from '../utils/llm.js';
import { AGENT_CONFIG, VERIFIER_PROMPT } from '../config.js';

/**
 * Récupère les contacts avec status "new" et email non null (limité par CONTACTS_TO_VERIFY, "*" = sans limite).
 */
async function getNewContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_VERIFY ?? 100;
  const hasLimit = limitRaw !== '*';

  let query = supabaseClient
    .from('contacts')
    .select('*')
    .eq('status', 'new')
    .not('email', 'is', null)
    .order('created_at', { ascending: true });

  if (hasLimit) {
    query = query.limit(limitRaw);
  } else {
    query = query.limit(10000); // pratique "sans limite"
  }

  const { data, error } = await query;

  if (error) {
    console.error('[verifier] Erreur Supabase:', error.message);
    throw error;
  }
  return data || [];
}

/**
 * 1. Vérification : Titre et description sont en français ? (isFrenchText).
 */
function filterFrenchContacts(contacts) {
  return contacts.filter(c => {
    const add = c.additional_data || {};
    const text = [add.title, add.description].filter(Boolean).join(' ');
    return isFrenchText(text);
  });
}

/**
 * 2. Vérification : Les emails sont valides ? (ok, catch_all, unknown).
 */
async function verifyContacts(contacts) {
  if (contacts.length === 0) return [];
  return filterValidContacts(contacts);
}

/**
 * 3. Vérification d'intérêt : ce contact est-il un indépendant en potentiel recherche de missions ?
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
 * Met à jour le status et la note du contact en base.
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

  const frenchContacts = filterFrenchContacts(contacts);
  const rejectedFrench = contacts.length - frenchContacts.length;
  console.log(`Après filtre français (1): ${frenchContacts.length}`);

  const verifiedContacts = await verifyContacts(frenchContacts);
  const rejectedMv = frenchContacts.length - verifiedContacts.length;
  console.log(`Après MillionVerifier (2): ${verifiedContacts.length}`);

  const interestResults = new Map();
  for (const c of verifiedContacts) {
    const { hasInterest, explanation } = await verifyContactInterest(c);
    interestResults.set(c.email.toLowerCase(), { hasInterest, explanation });
  }
  const verifiedEmails = new Set([...interestResults.entries()].filter(([, v]) => v.hasInterest).map(([k]) => k));
  const rejectedInterest = verifiedContacts.length - verifiedEmails.size;
  console.log(`Après vérification d'intérêt (3): ${verifiedEmails.size}`);

  const frenchEmails = new Set(frenchContacts.map(c => c.email.toLowerCase()));
  const mvEmails = new Set(verifiedContacts.map(c => c.email.toLowerCase()));

  let verified = 0;
  let rejected = 0;
  let failed = 0;

  for (const contact of contacts) {
    const email = (contact.email || '').toLowerCase();
    const isVerified = verifiedEmails.has(email);
    const status = isVerified ? 'verified' : 'rejected';

    let note = null;
    if (!isVerified) {
      if (!frenchEmails.has(email)) {
        note = 'Rejeté: Titre et description non français.';
      } else if (!mvEmails.has(email)) {
        note = 'Rejeté: Email invalide ou non vérifié (MillionVerifier).';
      } else {
        const { explanation } = interestResults.get(email) || {};
        note = explanation
          ? `Rejeté: Pas d'intérêt pour missions. ${explanation}`
          : 'Rejeté: Pas d\'intérêt pour missions (vérification LLM).';
      }
    }

    try {
      await setContactStatus(contact.id, status, note);
      if (status === 'verified') verified++;
      else rejected++;
    } catch (err) {
      failed++;
      console.error(`[verifier] Échec mise à jour ${contact.email}: ${err.message}`);
    }
  }

  console.log('\n--- Récap ---');
  console.log(`Traités: ${contacts.length} | Verified: ${verified} | Rejected: ${rejected}${failed > 0 ? ` | Échecs Supabase: ${failed}` : ''}`);
  console.log(`  → Rejetés (français): ${rejectedFrench} | Rejetés (MillionVerifier): ${rejectedMv} | Rejetés (intérêt): ${rejectedInterest}`);
  console.log('Vérification terminée.');
})();
