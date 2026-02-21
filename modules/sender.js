/**
 * Module 5 - Sender
 * 1. Sélectionne les contacts avec status "ready" (les plus anciens en premier)
 * 2. Pour chaque contact : passe le status à "processing", récupère l'email draft, envoie via Resend
 * 3. Met à jour le contact (processed/error) et l'email (sent/error)
 */

import 'dotenv/config';
import { supabaseClient, supabaseSelect, supabaseSelectWithFilters, supabaseUpdate } from '../utils/supabase.js';
import { sendEmail } from '../utils/resend.js';
import { AGENT_CONFIG } from '../config.js';

/**
 * 1. Récupère les contacts avec status "ready" (limité par CONTACTS_TO_SEND, "*" = sans limite)
 */
async function getReadyContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_SEND ?? 1;
  const hasLimit = limitRaw !== '*';

  let query = supabaseClient
    .from('contacts')
    .select('*')
    .eq('status', 'ready')
    .not('email', 'is', null)
    .order('created_at', { ascending: true });

  if (hasLimit) {
    query = query.limit(limitRaw);
  } else {
    query = query.limit(10000);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[sender] Erreur Supabase:', error.message);
    throw error;
  }
  return data || [];
}

/**
 * Récupère l'identité par ID
 */
async function getIdentityById(identityId) {
  if (!identityId) return null;
  const rows = await supabaseSelect('identities', 'id', identityId, 1);
  return rows?.[0] ?? null;
}

/**
 * Récupère la première identité active (fallback)
 */
async function getFirstActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * Récupère l'email draft pour un contact
 */
async function getDraftEmail(contactId) {
  const rows = await supabaseSelectWithFilters(
    'emails',
    { contact_id: contactId, status: 'draft' },
    1,
    'created_at',
    false
  );
  return rows?.[0] ?? null;
}

/**
 * Construit l'adresse expéditrice au format Resend "Nom <email@domain.com>"
 */
function buildFromAddress(identity) {
  if (!identity || !identity.email) return null;
  const name = identity.fullname || identity.full_name || identity.name || 'Expéditeur';
  return `${name} <${identity.email}>`;
}

/**
 * Assemble le corps de l'email (content + cta + footer) en texte brut
 */
function buildEmailBody(emailRecord) {
  const parts = [emailRecord.content, emailRecord.cta, emailRecord.footer].filter(Boolean);
  return parts.join('\n\n').trim();
}

/**
 * 2. Envoie l'email au contact via Resend et met à jour les statuts
 */
async function sendEmailToContact(contact, emailRecord, identity, logPrefix = '') {
  const from = buildFromAddress(identity);
  if (!from) {
    throw new Error('Identité expéditeur manquante (email requis)');
  }

  const body = buildEmailBody(emailRecord);

  await sendEmail({
    from,
    to: contact.email,
    subject: emailRecord.object,
    text: body
  });

  await supabaseUpdate('contacts', 'id', contact.id, { status: 'processed' });
  await supabaseUpdate('emails', 'id', emailRecord.id, { status: 'sent' });
  console.log(`${logPrefix} ✓ Email envoyé à ${contact.email}`);
}

// --- Exécution principale ---

(async function main() {
  const contacts = await getReadyContacts();
  console.log('\n--- Sender ---\n');
  console.log(`Contacts prêts à envoyer: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_SEND === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_SEND})`);

  let sent = 0;
  let errors = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;

    try {
      const emailRecord = await getDraftEmail(contact.id);
      if (!emailRecord) {
        console.warn(`${progress} Contact ${contact.email}: aucun email draft trouvé, skip\n`);
        continue;
      }

      const identityId = contact.additional_data?.active_identity_id;
      let identity = await getIdentityById(identityId);
      if (!identity) {
        identity = await getFirstActiveIdentity();
      }
      if (!identity) {
        throw new Error('Aucune identité active trouvée pour l\'expéditeur');
      }

      console.log(`${progress} --- Contact: ${contact.email} ---`);
      await supabaseUpdate('contacts', 'id', contact.id, { status: 'processing' });

      await sendEmailToContact(contact, emailRecord, identity, progress);
      sent++;
      console.log(`${progress} OK\n`);
    } catch (err) {
      errors++;
      console.error(`${progress} Erreur: ${err.message}\n`);

      try {
        await supabaseUpdate('contacts', 'id', contact.id, { status: 'error' });
        const emailRecord = await getDraftEmail(contact.id);
        if (emailRecord) {
          await supabaseUpdate('emails', 'id', emailRecord.id, { status: 'error' });
        }
      } catch (updateErr) {
        console.error(`${progress} Échec mise à jour statuts: ${updateErr.message}`);
      }
    }
  }

  console.log('--- Récap final ---');
  console.log(`Emails envoyés: ${sent}`);
  console.log(`Erreurs: ${errors}`);
  console.log('Sender terminé.');
})();
