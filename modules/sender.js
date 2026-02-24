/**
 * Module 5 - Sender
 * 1. Sélectionne les contacts avec status "ready" (les plus anciens en premier)
 * 2. Pour chaque contact : passe le status à "processing", récupère l'email draft, envoie via Resend
 * 3. Met à jour le contact (processed/error) et l'email (sent/error)
 */

import 'dotenv/config';
import { supabaseClient, supabaseSelect, supabaseSelectWithFilters, supabaseUpdate } from '../utils/supabase.js';
import { sendEmail, getVerifiedSendingDomains } from '../utils/resend.js';
import { AGENT_CONFIG } from '../config.js';

/**
 * 1. Supabase : Sourcer les contacts avec status "ready"
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
 * 1 Supabase : Sélectionner la première identité active
 */
async function getFirstActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * 2 Supabase : Sélectionner l'email "draft" à envoyer au contact
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
 * 3. Supabase : Construire l'adresse expéditrice 
 */
function buildFromAddress(identity, domainName) {
  if (!identity || !identity.fullname || !identity.company) return null;
  const company = identity.company.toLowerCase().replace(/\s+/g, '.');
  return `${identity.fullname} <${company}@${domainName}>`;
}

/**
 * Normalise le contenu email en versions texte + HTML.
 * - Garde des doubles sauts entre les sections
 * - Supporte les <br> déjà présents
 */
function buildEmailBodies(emailRecord) {
  const sections = [emailRecord.content, emailRecord.cta, emailRecord.footer]
    .map((part) => (part || '').trim())
    .filter(Boolean);

  const raw = sections.join('\n\n');

  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const html = text
    .split('\n\n')
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('\n');

  return { text, html };
}


/**
 * 4. Resend : Envoyer l'email au contact via l'adresse construite
 */
async function sendEmailToContact(contact, emailRecord, identity, domainName, logPrefix = '') {
  const from = buildFromAddress(identity, domainName);
  if (!from) {
    throw new Error('Identité expéditeur manquante (email requis)');
  }

  const { text, html } = buildEmailBodies(emailRecord);

  await sendEmail({
    from,
    to: contact.email,
    subject: emailRecord.object,
    text,
    html
  });

  await supabaseUpdate('contacts', 'id', contact.id, { status: 'processed' });
  await supabaseUpdate('emails', 'id', emailRecord.id, {
    status: 'sent',
    sent_at: new Date().toISOString(),
    used_domain: domainName,
    error: null
  });
  console.log(`${logPrefix} ✓ Email envoyé à ${contact.email} via ${domainName}`);
}

// --- Exécution principale ---

(async function main() {
  const contacts = await getReadyContacts();
  const sendingDomains = await getVerifiedSendingDomains();
  let domainIndex = 0;

  console.log('\n--- Sender ---\n');
  console.log(`Contacts prêts à envoyer: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_SEND === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_SEND})`);
  console.log(`Domaines disponibles pour envoi: ${sendingDomains.length}`);

  let sent = 0;
  let errors = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;

    try {
      const emailRecord = await getDraftEmail(contact.id);
      if (!emailRecord) {
        await supabaseUpdate('contacts', 'id', contact.id, { status: 'enriched' });
        console.warn(`${progress} Contact ${contact.email}: aucun email draft trouvé, skip\n`);
        continue;
      }

      const identity = await getFirstActiveIdentity();
      if (!identity) {
        throw new Error('Aucune identité active trouvée pour l\'expéditeur');
      }

      console.log(`${progress} --- Contact: ${contact.email} ---`);
      await supabaseUpdate('contacts', 'id', contact.id, { status: 'processing' });

      const selectedDomain = sendingDomains[domainIndex % sendingDomains.length];
      domainIndex += 1;

      await sendEmailToContact(contact, emailRecord, identity, selectedDomain.name, progress);
      sent++;
      console.log(`${progress} OK\n`);
    } catch (err) {
      errors++;
      console.error(`${progress} Erreur: ${err.message}\n`);

      try {
        await supabaseUpdate('contacts', 'id', contact.id, { status: 'error' });
        const emailRecord = await getDraftEmail(contact.id);
        if (emailRecord) {
          await supabaseUpdate('emails', 'id', emailRecord.id, {
            status: 'error',
            error: err?.message || 'Erreur inconnue'
          });
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
