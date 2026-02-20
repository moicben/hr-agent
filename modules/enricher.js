/**
 * Module 2 - Enrichissement
 * 1. Sourcer les contacts status "new" avec email
 * 2. Extraire le texte de la page d'accueil (additional_data.web ou additional_data.url)
 * 3. Générer un persona explicite via LLM
 * 4. Choisir l'identité active (identities.active = true)
 */

import 'dotenv/config';
import { supabaseClient, supabaseUpdate, supabaseSelect } from '../utils/supabase.js';
import { fetchPageText } from '../utils/fetch.js';
import { localLlmRequest } from '../utils/llm.js';
import { AGENT_CONFIG, PERSONA_PROMPT } from '../config.js';

const MEDIA_EXTENSIONS = /\.(avif|jpeg|jpg|png|gif|webp|svg|bmp|tiff|ico|mp4|webm|mov|avi|mp3|wav|flac|pdf)$/i;

/**
 * 1. Récupère les contacts avec status "new" et email non null (limité par CONTACTS_TO_ENRICH, "*" = sans limite)
 */
async function getNewContactsWithEmail() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_ENRICH ?? 100;
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
    console.error('[enrich] Erreur Supabase:', error.message);
    throw error;
  }
  return (data || []).filter(c => !MEDIA_EXTENSIONS.test((c.email || '').trim().toLowerCase()));
}

/**
 * Dérive l'URL de la page d'accueil (origin + /) à partir d'une URL quelconque.
 * Le chemin (nombre de segments après /) est ignoré.
 */
function getHomepageUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl).trim());
    return `${u.origin}/`;
  } catch {
    return null;
  }
}

/**
 * 2. Extrait les 1000 premiers caractères textuels du body de la home page du contact.
 * L'URL est dérivée de additional_data.web ou additional_data.url. Skip si réseau social.
 */
async function enrichWithWebContent(contact) {
  const add = contact.additional_data || {};
  const rawUrl = add.web || add.url;
  if (!rawUrl) return null;

  const homepageUrl = getHomepageUrl(rawUrl);
  if (!homepageUrl) return null;

  return fetchPageText(homepageUrl, AGENT_CONFIG.CHARS_TO_EXTRACT);
}

/**
 * 3. Génère le persona explicite via LLM à partir des données agrégées
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
 * 4. Récupère la première identité active dans Supabase (table identities, colonne active = true).
 * Retourne l'identité active ou null si aucune
 */
async function getActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * 5. Met à jour le contact enrchis dans Supabase avec le status "enriched"
 * et l'identité active (active_identity_id)
 */
async function enrichContact(contact, activeIdentity, logPrefix = '') {
  const id = contact.id;

  console.log(`${logPrefix}  → fetch page web...`);
  const webText = await enrichWithWebContent(contact);
  console.log(`${logPrefix}  → génération persona (LLM)...`);
  const persona = await generatePersona(contact, webText);

  const updatedAdditionalData = {
    ...(contact.additional_data || {}),
    ...(activeIdentity?.id && { active_identity_id: activeIdentity.id })
  };

  await supabaseUpdate('contacts', 'id', id, {
    persona: persona.trim(),
    additional_data: updatedAdditionalData,
    status: 'enriched'
  });
}

// --- Exécution principale ---

(async function main() {
  const contacts = await getNewContactsWithEmail();
  console.log(`\n--- Enrichissement ---\n`);
  console.log(`Contacts à enrichir: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_ENRICH === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_ENRICH})`);

  const activeIdentity = await getActiveIdentity();
  if (!activeIdentity) {
    console.error('\nAucune identité active trouvée (identities.active = true). Arrêt.');
    process.exit(1);
  }
  console.log(`Identité active: ${activeIdentity.id}\n`);

  let enriched = 0;
  let errors = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;
    try {
      console.log(`${progress} --- Contact: ${contact.email} ---`);
      await enrichContact(contact, activeIdentity, progress);
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
