/**
 * Module 4 - Copywrite
 * 1. Récupère les contacts avec status "enriched" depuis Supabase
 * 2. Pour chaque contact, personnalise le template email via LLM (persona + identité)
 * 3. Stocke chaque email personnalisé dans la table emails (object, content, cta, footer, contact_id)
 * 4. Met à jour le status du contact à "ready"
 */

import 'dotenv/config';
import { supabaseClient, supabaseInsert, supabaseSelect, supabaseUpdate } from '../utils/supabase.js';
import { localLlmRequest } from '../utils/llm.js';
import { AGENT_CONFIG, EMAIL_TEMPLATE, COPYWRITE_PROMPT } from '../config.js';

const MEDIA_EXTENSIONS = /\.(avif|jpeg|jpg|png|gif|webp|svg|bmp|tiff|ico|mp4|webm|mov|avi|mp3|wav|flac|pdf)$/i;

/**
 * 1. Récupère les contacts avec status "enriched" depuis Supabase (limité par CONTACTS_TO_COPYWRITE, "*" = sans limite)
 */
async function getEnrichedContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_COPYWRITE ?? 5;
  const hasLimit = limitRaw !== '*';

  let query = supabaseClient
    .from('contacts')
    .select('*')
    .eq('status', 'enriched')
    .not('email', 'is', null)
    .order('created_at', { ascending: true });

  if (hasLimit) {
    query = query.limit(limitRaw);
  } else {
    query = query.limit(10000); // pratique "sans limite"
  }

  const { data, error } = await query;

  if (error) {
    console.error('[copywrite] Erreur Supabase:', error.message);
    throw error;
  }
  return (data || []).filter(c => !MEDIA_EXTENSIONS.test((c.email || '').trim().toLowerCase()));
}

/**
 * Récupère l'identité par ID (depuis active_identity_id du contact)
 */
async function getIdentityById(identityId) {
  if (!identityId) return null;
  const rows = await supabaseSelect('identities', 'id', identityId, 1);
  return rows?.[0] ?? null;
}

/**
 * Récupère la première identité active (fallback si le contact n'a pas active_identity_id)
 */
async function getFirstActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * Vérifie si un email existe déjà pour ce contact
 */
async function hasExistingEmail(contactId) {
  const rows = await supabaseSelect('emails', 'contact_id', contactId, 1);
  return rows && rows.length > 0;
}

/**
 * 2. Personnalise le template email via LLM à partir du persona et de l'identité
 */
async function personalizeEmail(contact, identity, template) {
  const persona = contact.persona || contact.additional_data?.persona || '(aucun persona)';
  const identityData = identity
    ? JSON.stringify(identity, null, 2)
    : '(aucune identité)';

  const systemPrompt = COPYWRITE_PROMPT[0].system.trim();
  const userPrompt = COPYWRITE_PROMPT[0].user
    .replace(/\{\{template_object\}\}/g, template.object)
    .replace(/\{\{template_content\}\}/g, template.content)
    .replace(/\{\{template_cta\}\}/g, template.cta)
    .replace(/\{\{template_footer\}\}/g, template.footer)
    .replace(/\{\{persona\}\}/g, persona)
    .replace(/\{\{identity_data\}\}/g, identityData)
    .trim();

  const response = await localLlmRequest(systemPrompt, userPrompt, 0.5, 800);

  // Parse JSON (retirer éventuels backticks markdown)
  let jsonStr = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Caractères de contrôle (ex. retours à la ligne/tabs bruts) invalides dans une string JSON → espace
  jsonStr = jsonStr.replace(/[\x00-\x1f\x7f]/g, ' ');
  const parsed = JSON.parse(jsonStr);

  return {
    object: parsed.object || template.object,
    content: parsed.content || template.content,
    cta: parsed.cta || template.cta,
    footer: parsed.footer || template.footer
  };
}

 // 3. Stocke l'email personnalisé dans la table emails
async function storeEmail(contactId, personalized) {
  await supabaseInsert('emails', {
    contact_id: contactId,
    object: personalized.object,
    content: personalized.content,
    cta: personalized.cta,
    footer: personalized.footer,
    status: 'draft'
  });
}

// 4. Passer le status du contact à "ready"
async function setContactStatusReady(contactId) {
  await supabaseUpdate('contacts', 'id', contactId, { status: 'ready' });
}

// --- Exécution principale ---

(async function main() {
  const contacts = await getEnrichedContacts();
  console.log('\n--- Copywrite ---\n');
  console.log(`Contacts enrichis à traiter: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_COPYWRITE === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_COPYWRITE})`);

  const template = EMAIL_TEMPLATE[0];
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      const hasEmail = await hasExistingEmail(contact.id);
      if (hasEmail) {
        console.log(`--- Contact ${contact.email}: email déjà existant, skip ---\n`);
        skipped++;
        continue;
      }

      const identityId = contact.additional_data?.active_identity_id;
      let identity = await getIdentityById(identityId);
      if (!identity) {
        identity = await getFirstActiveIdentity();
        if (!identity) {
          console.warn(`--- Contact ${contact.email}: aucune identité active trouvée, email avec "(aucune identité)" ---`);
        }
      }

      console.log(`--- Contact: ${contact.email} ---`);
      const personalized = await personalizeEmail(contact, identity, template);
      await storeEmail(contact.id, personalized);
      await setContactStatusReady(contact.id);
      processed++;
      console.log(`OK\n`);
    } catch (err) {
      errors++;
      console.error(`Erreur: ${err.message}\n`);
    }
  }

  console.log('--- Récap final ---');
  console.log(`Emails personnalisés créés: ${processed}`);
  console.log(`Ignorés (déjà existants): ${skipped}`);
  console.log(`Erreurs: ${errors}`);
  console.log('Copywrite terminé.');
})();
