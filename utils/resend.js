import { Resend } from 'resend';

/**
 * Envoie un email via Resend
 * @param {object} cfg
 * @param {string} cfg.apiKey - Clé API Resend (default: process.env.RESEND_API_KEY)
 * @param {string} cfg.from - Adresse expéditrice (format: "Nom <email@domain.com>")
 * @param {string|string[]} cfg.to - Destinataire(s)
 * @param {string} cfg.subject - Sujet de l'email
 * @param {string} [cfg.html] - Contenu HTML de l'email
 * @param {string} [cfg.text] - Contenu texte de l'email (fallback)
 * @returns {Promise<object>} Réponse de l'API Resend
 */
export async function sendEmail({ 
  apiKey = process.env.RESEND_API_KEY, 
  from, 
  to, 
  subject, 
  html,
  text
}) {
  if (!apiKey) {
    throw new Error('Clé API Resend manquante (RESEND_API_KEY)');
  }
  
  if (!from || !to || !subject) {
    throw new Error('Paramètres manquants: from, to, subject requis');
  }

  if (!html && !text) {
    throw new Error('Contenu email manquant: html ou text requis');
  }

  const resend = new Resend(apiKey);

  // console.log(`[Resend] Envoi email à ${Array.isArray(to) ? to.join(', ') : to} - Sujet: ${subject}`);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html,
      text: text || 'Message HTML uniquement',
    });

    if (error) {
      console.error('[Resend] Erreur API:', error);
      throw new Error(`Erreur Resend: ${JSON.stringify(error)}`);
    }

    // console.log(`[Resend] ✓ Email envoyé avec succès:`, data);
    return { success: true, data };
  } catch (error) {
    console.error(`[Resend] Erreur envoi email:`, error.message);
    throw error;
  }
}

