const DEFAULT_SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL || 'http://localhost:8080';

/**
 * Interroge SearXNG et normalise la réponse pour le scraper.
 * @returns {Promise<{results: Array<{title: string, snippet: string, link: string}>, engines: string[]}>}
 */
export async function searchSearxng({
  query,
  page = 1,
  language = 'fr-FR',
  baseUrl = DEFAULT_SEARXNG_BASE_URL,
  verbose = false
}) {
  if (!query || !query.trim()) return { results: [], engines: [] };

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
  const normalizeEngineNames = enginesList =>
    (Array.isArray(enginesList) ? enginesList : [])
      .map(engine => {
        if (typeof engine === 'string') return engine;
        if (engine && typeof engine.name === 'string') return engine.name;
        return '';
      })
      .map(name => name.trim())
      .filter(Boolean);

  // Certaines instances SearXNG renvoient les moteurs au niveau racine (data.engines),
  // d'autres les renvoient par résultat (result.engine / result.engines).
  const enginesFromPayload = normalizeEngineNames(data?.engines);
  const enginesFromResults = results
    .flatMap(result => {
      const singleEngine = typeof result?.engine === 'string' ? [result.engine] : [];
      const manyEngines = normalizeEngineNames(result?.engines);
      return [...singleEngine, ...manyEngines];
    })
    .map(name => name.trim())
    .filter(Boolean);

  const uniqueEngines = [...new Set([...enginesFromPayload, ...enginesFromResults])];

  return {
    results: results.map(result => ({
      title: result?.title || '',
      snippet: result?.content || '',
      link: result?.url || ''
    })),
    engines: uniqueEngines
  };
}
