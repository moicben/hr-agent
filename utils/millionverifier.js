/**
 * MillionVerifier - Vérification d'emails
 * @see https://developer.millionverifier.com/
 *
 * Utilise la Single API (GET) avec requêtes parallèles par chunks.
 * Plus rapide et pratique que la Bulk API (pas de fichier, pas de polling).
 */

import 'dotenv/config';

const API_KEY = process.env.MILLIONVERIFIER_API_KEY;
const SINGLE_API_URL = 'https://api.millionverifier.com/api/v3/';
const CONCURRENCY = 5;
const VALID_RESULTS = ['ok', 'catch_all', 'unknown']; // ok = valide, catch_all = domaine accepte tout, unknown = indéterminé

/**
 * Vérifie un seul email via la Single API.
 * @param {string} email
 * @returns {Promise<{email: string, result: string, valid: boolean}>}
 */
export async function verifyEmail(email) {
  if (!API_KEY) {
    throw new Error('MILLIONVERIFIER_API_KEY manquant dans .env');
  }

  const url = new URL(SINGLE_API_URL);
  url.searchParams.set('api', API_KEY);
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', '10');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MillionVerifier erreur ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`MillionVerifier: ${data.error}`);
  }

  const valid = VALID_RESULTS.includes(data.result?.toLowerCase());

  return {
    email,
    result: data.result || 'unknown',
    valid
  };
}

/**
 * Vérifie une liste d'emails en parallèle (par chunks).
 * @param {string[]} emails - Liste d'emails à vérifier
 * @returns {Promise<{valid: string[], invalid: string[], results: Array}>}
 */
export async function verifyEmails(emails) {
  if (!emails || emails.length === 0) {
    return { valid: [], invalid: [], results: [] };
  }

  const results = [];

  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const chunk = emails.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(email => verifyEmail(email).catch(err => ({ email, result: 'error', valid: false, error: err.message })))
    );
    results.push(...chunkResults);
  }

  const valid = results.filter(r => r.valid).map(r => r.email);
  const invalid = results.filter(r => !r.valid).map(r => r.email);

  return { valid, invalid, results };
}

/**
 * Filtre une liste de contacts pour ne garder que les emails vérifiés valides.
 * Si MILLIONVERIFIER_API_KEY est absent, retourne tous les contacts (pas de vérification).
 * @param {Array<{email: string, title?: string, description?: string, url?: string}>} contacts
 * @returns {Promise<Array>} Contacts dont l'email est ok, catch_all ou unknown
 */
export async function filterValidContacts(contacts) {
  if (!API_KEY) {
    console.warn('MILLIONVERIFIER_API_KEY manquant: vérification ignorée, tous les contacts conservés.');
    return contacts;
  }

  const emails = contacts.map(c => c.email);
  const { valid } = await verifyEmails(emails);

  const validSet = new Set(valid);
  return contacts.filter(c => validSet.has(c.email));
}
