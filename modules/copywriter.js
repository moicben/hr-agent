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
 * Répare un JSON "presque valide" où des caractères de contrôle
 * (retours ligne, tabulations, etc.) sont insérés bruts dans des strings.
 */
function repairJsonControlChars(input) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);

    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      continue;
    }

    if (ch === '\r') {
      out += '\\r';
      continue;
    }

    if (ch === '\t') {
      out += '\\t';
      continue;
    }

    out += (code < 0x20 || code === 0x7f) ? ' ' : ch;
  }

  return out;
}

/**
 * 1. Récupère les contacts avec status "enriched"  
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
 * 2. Supabase: Récupère la première identité active
 */
async function getFirstActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * 2.1 Supabase: Vérifie si un email existe déjà pour ce contact
 */
async function hasExistingEmail(contactId) {
  const rows = await supabaseSelect('emails', 'contact_id', contactId, 1);
  return rows && rows.length > 0;
}

/**
 * 3. LLM: Personnalisation du template email 
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
    .replace(/\{\{persona\}\}/g, persona)
    .replace(/\{\{identity_data\}\}/g, identityData)
    .trim();

  const response = await localLlmRequest(systemPrompt, userPrompt, 0.5, 800);

  // 3.1 Parse JSON (retirer éventuels backticks markdown)
  let jsonStr = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  // 3.2 Parse direct puis fallback robuste pour JSON "presque valide"
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    jsonStr = repairJsonControlChars(jsonStr);
    parsed = JSON.parse(jsonStr);
  }

  return {
    object: parsed.object || template.object,
    content: parsed.content || template.content,
  };
}

/**
 * 3.1 Injecte l'id Supabase du contact dans le contenu template.
 */
function withContactIdInTemplate(template, contactId) {
  return {
    ...template,
    content: (template.content || '').replace(/\{\{contactId\}\}/g, String(contactId ?? ''))
  };
}

 // 4. Supabase: Stocke l'email personnalisé dans la table emails
async function storeEmail(contactId, personalized) {
  await supabaseInsert('emails', {
    contact_id: contactId,
    object: personalized.object,
    content: personalized.content,
    status: 'draft'
  });
}

// 5. Supabase: Passer le status du contact à "ready"
async function setContactStatusReady(contactId) {
  await supabaseUpdate('contacts', 'id', contactId, { status: 'ready' });
}

// 5.1 Supabase: Associer l'identité utilisée au contact
async function setContactIdentity(contactId, identityId) {
  await supabaseUpdate('contacts', 'id', contactId, { identity_id: identityId });
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
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;
    try {
      const hasEmail = await hasExistingEmail(contact.id);
      if (hasEmail) {
        console.log(`${progress} --- Contact ${contact.email}: email déjà existant, skip ---\n`);
        skipped++;
        continue;
      }

      const identity = await getFirstActiveIdentity();
      if (!identity) {
        console.warn(`${progress} --- Contact ${contact.email}: aucune identité active trouvée, email avec "(aucune identité)" ---`);
      } else {
        await setContactIdentity(contact.id, identity.id);
      }

      console.log(`${progress} --- Contact: ${contact.email} ---`);
      const templateWithContactId = withContactIdInTemplate(template, contact.id);
      const personalized = await personalizeEmail(contact, identity, templateWithContactId);
      await storeEmail(contact.id, personalized);
      await setContactStatusReady(contact.id);
      processed++;
      console.log(`${progress} OK\n`);
    } catch (err) {
      errors++;
      console.error(`${progress} Erreur: ${err.message}\n`);
    }
  }

  console.log('--- Récap final ---');
  console.log(`Emails personnalisés créés: ${processed}`);
  console.log(`Ignorés (déjà existants): ${skipped}`);
  console.log(`Erreurs: ${errors}`);
  console.log('Copywrite terminé.');
})();
