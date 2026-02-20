/**
 * Module 3 - Enrichissement
 * 1. Sourcer les contacts status "verified" avec email
 * 2. Extraire le contenu de la page source (URL du contact)
 * 3. Générer un persona explicite via LLM
 * 4. Générer les motivations via LLM
 * 5. Définir la query Google pour afficher des interlocuteurs/clients idéaux
 * 6. Sélectionner parmi les résultats Google l'interlocuteur idéal
 */

import 'dotenv/config';
import { supabaseClient, supabaseUpdate } from '../utils/supabase.js';
import { fetchPageText } from '../utils/fetch.js';
import { localLlmRequest } from '../utils/llm.js';
import { searchSerper } from '../utils/serper.js';
import {
  AGENT_CONFIG,
  PERSONA_PROMPT,
  MOTIVATION_PROMPT,
  INTERLOCUTOR_SEARCH_QUERY_PROMPT,
  INTERLOCUTOR_SELECTION_PROMPT
} from '../config.js';

/**
 * 1. Récupère les contacts avec status "verified" (limité par CONTACTS_TO_ENRICH, "*" = sans limite)
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
 * 2. Extrait les N premiers caractères de la page à l'URL du contact (additional_data.url ou .web).
 * Skip si réseau social (géré par fetchPageText).
 */
async function fetchWebTextForContact(contact) {
  const add = contact.additional_data || {};
  const rawUrl = add.web || add.url;
  if (!rawUrl) return null;
  return fetchPageText(rawUrl, AGENT_CONFIG.CHARS_TO_EXTRACT);
}

/**
 * 3. Génère le persona descriptif du contact via LLM (contact + web content)
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
 * 4. Défini via LLM les motivations du contact (contact data + persona)
 */
async function generateMotivations(contact, persona) {
  const add = contact.additional_data || {};
  const contactInformations = JSON.stringify({
    email: contact.email,
    source_query: contact.source_query,
    title: add.title,
    description: add.description,
    url: add.web || add.url
  }, null, 2);

  const systemPrompt = MOTIVATION_PROMPT[0].system.trim();
  const userPrompt = MOTIVATION_PROMPT[0].user
    .replace(/\{\{contact_informations\}\}/g, contactInformations)
    .replace(/\{\{persona\}\}/g, persona)
    .trim();

  return localLlmRequest(systemPrompt, userPrompt, 0.5, 200);
}

/**
 * 5. Choisir via LLM la query Google adapté à trouver le client idéal pour le prestataire
 */
async function generateInterlocutorQuery(persona, motivations) {
  const systemPrompt = INTERLOCUTOR_SEARCH_QUERY_PROMPT[0].system.trim();
  const userPrompt = INTERLOCUTOR_SEARCH_QUERY_PROMPT[0].user
    .replace(/\{\{persona\}\}/g, persona)
    .replace(/\{\{motivations\}\}/g, motivations)
    .trim();

  return localLlmRequest(systemPrompt, userPrompt, 0.5, 80);
}

/**
 * 6. Recherche Serper puis sélectionne l'interlocuteur idéal parmi les résultats via LLM
 */
async function selectInterlocutor(persona, motivations, searchQuery) {
  const { organic = [] } = await searchSerper({
    query: searchQuery,
    gl: 'fr',
    hl: 'fr',
    num: 10
  });

  const searchResults = organic.length > 0
    ? organic.map((r, i) => `${i + 1}. ${r.title || ''} | ${r.link || ''} | ${r.snippet || ''}`).join('\n')
    : '(aucun résultat)';

  const systemPrompt = INTERLOCUTOR_SELECTION_PROMPT[0].system.trim();
  const userPrompt = INTERLOCUTOR_SELECTION_PROMPT[0].user
    .replace(/\{\{persona\}\}/g, persona)
    .replace(/\{\{motivations\}\}/g, motivations)
    .replace(/\{\{search_results\}\}/g, searchResults)
    .trim();

  const raw = await localLlmRequest(systemPrompt, userPrompt, 0.3, 300);
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(trimmed);
}

/**
 * Enrichit un contact : extraction web, persona, motivations, query interlocuteur, sélection interlocuteur
 */
async function enrichContact(contact, logPrefix = '') {
  const id = contact.id;

  console.log(`${logPrefix}  → extraction page source...`);
  const webText = await fetchWebTextForContact(contact);
  if (!webText || !webText.trim()) {
    const url = contact.additional_data?.web || contact.additional_data?.url || '(aucune)';
    console.log(`${logPrefix}  ⚠ contenu vide (URL: ${url}) — fallback sur données contact uniquement`);
  }
  console.log(`${logPrefix}  → génération persona (LLM)...`);
  const persona = await generatePersona(contact, webText);

  console.log(`${logPrefix}  → génération motivations (LLM)...`);
  const motivations = await generateMotivations(contact, persona);

  console.log(`${logPrefix}  → génération query interlocuteur (LLM)...`);
  const interlocutorQuery = await generateInterlocutorQuery(persona, motivations);

  console.log(`${logPrefix}  → recherche Serper + sélection interlocuteur (LLM)...`);
  let interlocutorData = { interlocutor: null, company: null, source_url: null, localisation: null };
  try {
    interlocutorData = await selectInterlocutor(persona, motivations, interlocutorQuery.trim());
  } catch (err) {
    console.warn(`${logPrefix}  ⚠ sélection interlocuteur échouée: ${err.message}`);
  }

  const updatedAdditionalData = {
    ...(contact.additional_data || {}),
    motivations: motivations.trim(),
    interlocutor_search_query: interlocutorQuery.trim(),
    ...(interlocutorData.interlocutor && { interlocutor: interlocutorData.interlocutor }),
    ...(interlocutorData.company && { company: interlocutorData.company }),
    ...(interlocutorData.source_url && { source_url: interlocutorData.source_url }),
    ...(interlocutorData.localisation && { localisation: interlocutorData.localisation }),
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
