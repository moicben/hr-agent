/**
 * Module 5 - Sender
 * 1. Sélectionne les contacts avec status "verified" (les plus anciens en premier)
 * 2. Compose l'email localement depuis EMAIL_TEMPLATE (sans LLM)
 * 3. Envoie via Resend puis met à jour contacts/emails (processed|error / sent|error)
 */

import 'dotenv/config';
import { supabaseClient, supabaseInsert, supabaseSelect, supabaseUpdate } from '../utils/supabase.js';
import { sendEmail, getVerifiedSendingDomains } from '../utils/resend.js';
import { AGENT_CONFIG, EMAIL_TEMPLATE } from '../config.js';

function formatError(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 1. Supabase : Sourcer les contacts avec status "verified"
 */
async function getVerifiedContacts() {
  const limitRaw = AGENT_CONFIG.CONTACTS_TO_SEND ?? 1;
  const hasLimit = limitRaw !== '*';

  let query = supabaseClient
    .from('contacts')
    .select('*')
    .eq('status', 'verified')
    .not('email', 'is', null)
    .order('created_at', { ascending: true });

  if (hasLimit) {
    query = query.limit(limitRaw);
  } else {
    query = query.limit(10000);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[sender] Erreur Supabase:', formatError(error));
    throw error;
  }
  return data || [];
}

/**
 * 1.1 Supabase : Sélectionner la première identité active
 */
async function getFirstActiveIdentity() {
  const rows = await supabaseSelect('identities', 'active', true, 1, 'created_at', true);
  return rows?.[0] ?? null;
}

/**
 * 1.2 Supabase : Récupère l'identité liée au contact, fallback sur première active
 */
async function getIdentityForContact(contact) {
  if (contact?.identity_id) {
    const linked = await supabaseSelect('identities', 'id', contact.identity_id, 1);
    if (linked?.[0]) {
      return { identity: linked[0], fromLinkedIdentity: true };
    }
  }

  const active = await getFirstActiveIdentity();
  if (!active) return { identity: null, fromLinkedIdentity: false };
  return { identity: active, fromLinkedIdentity: false };
}

/**
 * 2. Supabase : Construire l'adresse expéditrice
 */
function buildFromAddress(identity, domainName) {
  if (!identity || !identity.fullname || !identity.company) return null;
  const company = identity.company.toLowerCase().replace(/\s+/g, '.');
  return `${identity.fullname} <${company}@${domainName}>`;
}

/**
 * 2.1 Remplace explicitement les variables connues dans un texte template.
 */
function applyTemplateVariables(input, values) {
  return String(input || '')
    .split('{{source_query}}').join(values.source_query)
    .split('{{contactId}}').join(values.contactId)
    .split('{{identity_id}}').join(values.identity_id)
    .split('{{sender_fullname}}').join(values.sender_fullname)
    .split('{{sender_company}}').join(values.sender_company)
    .split('{{company}}').join(values.company)
    .split('{{url}}').join(values.url);
}

function capitalizeWord(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Extrait un nom de site lisible depuis une URL.
 * Exemples:
 * - https://www.facebook.com/... -> Facebook
 * - https://fr.linkedin.com/...  -> Linkedin
 */
function getSiteNameFromUrl(rawUrl) {
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return capitalizeWord(parts[0]);

    const sldMarkers = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
    const candidate = sldMarkers.has(parts[parts.length - 2]) && parts.length >= 3
      ? parts[parts.length - 3]
      : parts[parts.length - 2];

    return capitalizeWord(candidate);
  } catch {
    const noProtocol = String(rawUrl)
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];
    const parts = noProtocol.split('.').filter(Boolean);
    if (!parts.length) return '';
    const fallback = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return capitalizeWord(fallback);
  }
}

/**
 * 2.2 Compose object + content localement depuis EMAIL_TEMPLATE.
 */
function composeEmailFromTemplate(contact, identity) {
  const template = EMAIL_TEMPLATE?.[0];
  if (!template) {
    throw new Error('EMAIL_TEMPLATE[0] est manquant dans config.js');
  }

  const additional = contact.additional_data || {};
  const siteName = getSiteNameFromUrl(additional.web || additional.url || '');
  const values = {
    source_query: String(contact.source_query || ''),
    contactId: String(contact.id || ''),
    identity_id: String(contact.identity_id || identity?.id || ''),
    sender_fullname: String(identity?.fullname || ''),
    sender_company: String(identity?.company || ''),
    company: String(identity?.company || ''),
    url: siteName
  };

  return {
    object: applyTemplateVariables(template.object, values).trim(),
    content: applyTemplateVariables(template.content, values).trim()
  };
}

/**
 * 2.3 Convertit directement le content en texte + HTML.
 */
function buildEmailBodies(content) {
  const text = String(content || '')
    .replace(/\r\n/g, '\n')
    .trim();

  const html = `<div>${text.replace(/\n/g, '<br />')}</div>`;
  return { text, html };
}

/**
 * 3. Supabase : Crée un email draft pour traçabilité.
 */
async function createDraftEmail(contactId, object, content) {
  return supabaseInsert('emails', {
    contact_id: contactId,
    object,
    content,
    status: 'draft'
  });
}


/**
 * 4. Resend : Envoyer l'email au contact via l'adresse construite
 */
async function sendEmailToContact(contact, emailRecord, identity, domainName, logPrefix = '') {
  const from = buildFromAddress(identity, domainName);
  if (!from) {
    throw new Error('Identité expéditeur manquante (email requis)');
  }

  const { text, html } = buildEmailBodies(emailRecord.content);

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
  const contacts = await getVerifiedContacts();
  const sendingDomains = await getVerifiedSendingDomains();
  if (!sendingDomains.length) {
    throw new Error('Aucun domaine Resend vérifié disponible');
  }

  let domainIndex = 0;

  console.log('\n--- Sender ---\n');
  console.log(`Contacts verified à envoyer: ${contacts.length} (limite: ${AGENT_CONFIG.CONTACTS_TO_SEND === '*' ? 'aucune' : AGENT_CONFIG.CONTACTS_TO_SEND})`);
  console.log(`Domaines disponibles pour envoi: ${sendingDomains.length}`);

  let sent = 0;
  let errors = 0;
  const total = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = `[${i + 1}/${total}]`;

    try {
      const { identity, fromLinkedIdentity } = await getIdentityForContact(contact);
      if (!identity) {
        throw new Error('Aucune identité trouvée (liée ou active) pour l\'expéditeur');
      }

      console.log(`${progress} --- Contact: ${contact.email} ---`);
      await supabaseUpdate('contacts', 'id', contact.id, { status: 'processing' });

      if (!fromLinkedIdentity && !contact.identity_id) {
        await supabaseUpdate('contacts', 'id', contact.id, { identity_id: identity.id });
        contact.identity_id = identity.id;
      }

      const composed = composeEmailFromTemplate(contact, identity);
      const emailRecord = await createDraftEmail(contact.id, composed.object, composed.content);

      const selectedDomain = sendingDomains[domainIndex % sendingDomains.length];
      domainIndex += 1;

      await sendEmailToContact(contact, emailRecord, identity, selectedDomain.name, progress);
      sent++;
      console.log(`${progress} OK\n`);
    } catch (err) {
      errors++;
      console.error(`${progress} Erreur: ${formatError(err)}\n`);

      try {
        await supabaseUpdate('contacts', 'id', contact.id, { status: 'error' });
        const rows = await supabaseSelect('emails', 'contact_id', contact.id, 1, 'created_at', false);
        const latestEmail = rows?.[0];
        if (latestEmail) {
          await supabaseUpdate('emails', 'id', latestEmail.id, {
            status: 'error',
            error: formatError(err)
          });
        }
      } catch (updateErr) {
        console.error(`${progress} Échec mise à jour statuts: ${formatError(updateErr)}`);
      }
    }
  }

  console.log('--- Récap final ---');
  console.log(`Emails envoyés: ${sent}`);
  console.log(`Erreurs: ${errors}`);
  console.log('Sender terminé.');
})().catch((err) => {
  console.error('[sender] Erreur fatale:', formatError(err));
  process.exit(1);
});
