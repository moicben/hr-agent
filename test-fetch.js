/**
 * Test de fetchPageText sur une URL donnée (1000 premiers chars du body)
 */
import { AGENT_CONFIG } from './config.js';

const url = 'https://thiant.fr/wordpress/vie-pratique/';
const maxChars = AGENT_CONFIG.CHARS_TO_EXTRACT ?? 1000;

function extractTextFromHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const fragment = bodyMatch ? bodyMatch[1] : html;
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log(`Test fetch sur: ${url}\n`);

try {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HR-Agent/1.0; +https://github.com/hr-agent)' },
    redirect: 'follow'
  });
  console.log(`Status: ${response.status} ${response.statusText}, OK: ${response.ok}`);

  const html = await response.text();
  const text = extractTextFromHtml(html);
  const sliced = text ? text.slice(0, maxChars) : null;

  if (sliced) {
    console.log(`\n--- 1000 premiers chars du body ---\n${sliced}\n\nLongueur: ${sliced.length}`);
  } else {
    console.log(`HTML: ${html.length} chars, texte extrait: ${text.length} chars → null`);
    if (html.length < 2500) console.log('\nHTML (extrait):', html.slice(0, 2000));
  }
} catch (err) {
  console.error('Erreur:', err.message);
}
