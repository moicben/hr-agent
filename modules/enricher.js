/**
 * Module 3 - Enrichissement
 * 1. Sourcer les contacts status "verified" avec email
 * 2. Extraire le contenu de la page source (URL du contact)
 * 3. Générer un persona explicite via LLM
 */

import 'dotenv/config';
import { supabaseClient, supabaseUpdate } from '../utils/supabase.js';
import { fetchPageText } from '../utils/fetch.js';
import { localLlmRequest } from '../utils/llm.js';
import { AGENT_CONFIG, PERSONA_PROMPT } from '../config.js';

/**
 * 1. Récupère les contacts avec status "verified" 
 */
async function getVerifiedContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_ENRICH ?? 100;
  const hasLimit = limitRaw !== '*';

  let query = supabaseClient
    .from('contacts')
    .select('*')
    .eq('status', 'verified')
    .order('created_at', { ascending: true });

  if (hasLimit) {
    query = query.limit(limitRaw);
  } else {
    query = query.limit(10000); // pratique "sans limite"
  }

  const { data, error } = await query;

  if (error) {
    console.error('[enrich] Erreur Supabase:', error.message);
    throw error;
  }
  return data || [];
}

/**
 * 2. Extraction du contenu de la page source du contact (sauf si réseau social)
 */
async function fetchWebTextForContact(contact) {
  const add = contact.additional_data || {};
  const rawUrl = add.web || add.url;
  if (!rawUrl) return null;
  return fetchPageText(rawUrl, AGENT_CONFIG.CHARS_TO_EXTRACT);
}

/**
 * 3.1 LLM : Fonction de génération du persona
 */
async function generatePersona(contact, webText) {
  const add = contact.additional_data || {};
  const contactInformations = JSON.stringify({
    email: contact.email,
    source_query: contact.source_query,
    title: add.title,
    description: add.description,
    url: add.web || add.url
  }, null, 2);
  const webInformations = webText || '(aucun contenu extrait)';

  const systemPrompt = PERSONA_PROMPT[0].system.trim();
  const userPrompt = PERSONA_PROMPT[0].user
    .replace(/\{\{contact_informations\}\}/g, contactInformations)
    .replace(/\{\{web_informations\}\}/g, webInformations)
    .trim();

  return localLlmRequest(systemPrompt, userPrompt, 0.5, 300);
}

/**
 * 3.2 Supabase / LLM : Enrichissement du persona + stockage
 */
async function enrichContact(contact, logPrefix = '') {
  const id = contact.id;

  console.log(`${logPrefix}  → extraction page source...`);
  const webText = await fetchWebTextForContact(contact);
  if (!webText || !webText.trim()) {
    console.log(`${logPrefix}  ⚠ contenu vide — fallback données contact`);
  }
  console.log(`${logPrefix}  → création persona (LLM)...`);
  const persona = await generatePersona(contact, webText);

  const updatedAdditionalData = {
    ...(contact.additional_data || {}),
    ...(webText?.trim() && { web_content: webText.trim() })
  };

  await supabaseUpdate('contacts', 'id', id, {
    persona: persona.trim(),
    additional_data: updatedAdditionalData,
    status: 'enriched'
  });
}




// --- Exécution principale ---

(async function main() {
  const contacts = await getVerifiedContacts();
  console.log(`\n--- Enrichissement ---\n`);
  console.log(`Contacts à enrichir: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_ENRICH === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_ENRICH})`);

  let enriched = 0;
  let errors = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;
    try {
      console.log(`${progress} --- Contact: ${contact.email} ---`);
      await enrichContact(contact, progress);
      enriched++;
      console.log(`${progress} OK\n`);
    } catch (err) {
      errors++;
      console.error(`${progress} Erreur: ${err.message}\n`);
    }
  }

  console.log('--- Récap final ---');
  console.log(`Contacts enrichis: ${enriched}`);
  console.log(`Erreurs: ${errors}`);
  console.log('Enrichissement terminé.');
})();
