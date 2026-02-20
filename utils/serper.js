import axios from 'axios';

export async function searchSerper({ query, page = 1, gl = null, hl = null, num = 20, tbs = null, apiKey = process.env.SERPER_API_KEY, verbose = false }) {
  const url = 'https://google.serper.dev/search';
  const headers = {
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json'
  };
  const payload = { q: query, num, page };
  if (gl) payload.gl = gl;
  if (hl) payload.hl = hl;
  if (tbs) payload.tbs = tbs;

  if (!apiKey) {
    const msg = 'SERPER_API_KEY est manquante. Ajoutez-la dans votre environnement (fichier .env ou variable d\'env) pour utiliser Serper.';
    if (verbose) console.error(`❌ [serper] ${msg}`);
    throw new Error(msg);
  }


  try {
    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error) {
    // Toujours afficher les détails d'erreur (status et body) pour diagnostiquer les problèmes de crédits API
    const status = error.response?.status;
    const body = error.response?.data ? JSON.stringify(error.response.data) : '';
    console.error(`❌ [serper] Erreur API: ${error.message}${status ? ` (status ${status})` : ''}${body ? ` -> ${body}` : ''}`);
    throw error;
  }
}