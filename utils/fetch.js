/**
 * Extrait les N premiers caractères textuels du body de la page d'accueil d'une URL.
 * Ignore les URLs de réseaux sociaux (facebook, instagram, linkedin, tiktok).
 * @param {string} url - URL à fetcher
 * @param {number} maxChars - Nombre max de caractères à extraire (défaut: 1000)
 * @returns {Promise<string|null>} Texte extrait ou null si skip/erreur
 */
export async function fetchPageText(url, maxChars = 1000) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  const socialPatterns = [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'tiktok.com'
  ];
  if (socialPatterns.some(p => lower.includes(p))) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(trimmed, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HR-Agent/1.0; +https://github.com/hr-agent)'
      },
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const text = extractTextFromHtml(html);
    return text ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

/**
 * Extrait le texte lisible du HTML (body uniquement).
 * @param {string} html
 * @returns {string}
 */
function extractTextFromHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const fragment = bodyMatch ? bodyMatch[1] : html;

  let text = fragment
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}
