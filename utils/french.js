/**
 * Détection de texte en français (mots courants, accents).
 */

const FRENCH_WORDS = /\b(le|la|les|des|du|de|un|une|et|pour|avec|sur|dans|vous|nous|rendez[- ]vous|appel|calendrier|réunion|rdv|bonjour|merci|entreprise|client|prestataire)\b/gi;

export function isFrenchText(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  const accents = (t.match(/[àâäçéèêëîïôöùûüÿœæ]/g) || []).length;
  if (accents >= 1) return true;
  if (/\.fr\b/.test(t)) return true; // domaine .fr
  const frWords = (t.match(FRENCH_WORDS) || []).length;
  return frWords >= 1;
}
