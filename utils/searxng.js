const DEFAULT_SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL || 'http://localhost:8080';

/**
 * Interroge SearXNG et normalise la réponse pour le scraper.
 * @returns {Promise<Array<{title: string, snippet: string, link: string}>>}
 */
export async function searchSearxng({
  query,
  page = 1,
  language = 'fr-FR',
  baseUrl = DEFAULT_SEARXNG_BASE_URL,
  verbose = false
}) {
  if (!query || !query.trim()) return [];

  const endpoint = new URL('/search', baseUrl);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('pageno', String(page));
  endpoint.searchParams.set('language', language);

  let response;
  try {
    response = await fetch(endpoint, { method: 'GET' });
  } catch (error) {
    const msg = `SearXNG indisponible (${endpoint.origin}). Vérifiez que le service localhost est démarré.`;
    if (verbose) console.error(`[searxng] ${msg}`);
    throw new Error(msg);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SearXNG HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];

  return results.map(result => ({
    title: result?.title || '',
    snippet: result?.content || '',
    link: result?.url || ''
  }));
}
