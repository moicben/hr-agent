import { createClient } from '@supabase/supabase-js';
import fetchRetry from 'fetch-retry';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseKey) missing.push('SUPABASE_SERVICE_KEY or SUPABASE_KEY');
  throw new Error(`Missing Supabase credentials: ${missing.join(', ')}`);
}

// fetch-retry : retries automatiques sur erreurs réseau (ex: "TypeError: fetch failed")
// Par défaut : 3 retries, backoff exponentiel, retry uniquement sur erreurs réseau
const fetchWithRetry = fetchRetry(fetch, {
  retries: 3,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
});

export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    fetch: fetchWithRetry,
  },
});

export function getSupabaseClient() {
  return supabaseClient;
}

/** Log erreur Supabase avec cause réseau si présente (ex: ECONNREFUSED, ENOTFOUND) */
function logSupabaseError(prefix, error) {
  let msg = `${prefix} Erreur: ${error.message}`;
  if (error.cause) {
    const c = error.cause;
    msg += ` (cause: ${c.code || c.errno || c.message || String(c)})`;
  }
  console.error(msg);
}


/**
 * Helper générique pour sélectionner des données depuis Supabase
 * @param {string} table - Nom de la table
 * @param {string} column - Colonne pour filtrer
 * @param {any} value - Valeur à rechercher
 * @param {number} limit - Nombre maximum de résultats
 * @param {string} orderBy - Colonne pour trier
 * @param {boolean} ascending - Ordre ascendant (true) ou descendant (false)
 * @returns {Promise<Array>}
 */
export async function supabaseSelect(table, column, value, limit = 100, orderBy = 'created_at', ascending = false) {
  try {
    let query = supabaseClient
      .from(table)
      .select('*')
      .eq(column, value)
      .limit(limit);

    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }

    const { data, error } = await query;

    if (error) {
      logSupabaseError('[supabaseSelect]', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    logSupabaseError('[supabaseSelect]', error);
    return [];
  }
}

/**
 * Helper générique pour insérer des données dans Supabase
 * @param {string} table - Nom de la table
 * @param {Object} data - Données à insérer
 * @returns {Promise<Object>}
 */
export async function supabaseInsert(table, data) {
  try {
    const { data: insertedData, error } = await supabaseClient
      .from(table)
      .insert(data)
      .select()
      .single();

    if (error) {
      logSupabaseError('[supabaseInsert]', error);
      throw error;
    }

    return insertedData;
  } catch (error) {
    logSupabaseError('[supabaseInsert]', error);
    throw error;
  }
}

/**
 * Helper générique pour mettre à jour des données dans Supabase
 * @param {string} table - Nom de la table
 * @param {string} column - Colonne pour identifier la ligne
 * @param {any} value - Valeur de la colonne
 * @param {Object} data - Données à mettre à jour
 * @returns {Promise<Object>}
 */
export async function supabaseUpdate(table, column, value, data) {
  try {
    const { data: updatedData, error } = await supabaseClient
      .from(table)
      .update(data)
      .eq(column, value)
      .select()
      .single();

    if (error) {
      logSupabaseError('[supabaseUpdate]', error);
      throw error;
    }

    return updatedData;
  } catch (error) {
    logSupabaseError('[supabaseUpdate]', error);
    throw error;
  }
}

/**
 * Helper pour sélectionner avec plusieurs filtres
 * @param {string} table - Nom de la table
 * @param {Object} filters - Objet avec les filtres { column: value } ou { column: { op: 'ilike', value: 'xxx' } }
 * @param {number} limit - Nombre maximum de résultats
 * @param {string} orderBy - Colonne pour trier
 * @param {boolean} ascending - Ordre ascendant (true) ou descendant (false)
 * @returns {Promise<Array>}
 */
export async function supabaseSelectWithFilters(table, filters = {}, limit = 100, orderBy = 'created_at', ascending = false) {
  try {
    const MAX_SUPABASE_LIMIT = 1000; // Limite maximale par requête Supabase
    const allResults = [];
    let offset = 0;
    const requestedLimit = Math.min(limit, 10000); // Limite de sécurité à 10000

    // Si la limite demandée est <= 1000, on fait une seule requête
    if (requestedLimit <= MAX_SUPABASE_LIMIT) {
      let query = supabaseClient
        .from(table)
        .select('*');

      // Appliquer tous les filtres
      for (const [column, filterValue] of Object.entries(filters)) {
        // Si le filtre est un objet avec op (ex: { op: 'ilike', value: 'xxx' })
        if (typeof filterValue === 'object' && filterValue.op && filterValue.value) {
          if (filterValue.op === 'ilike') {
            query = query.ilike(column, `%${filterValue.value}%`);
          } else if (filterValue.op === 'eq') {
            query = query.eq(column, filterValue.value);
          }
        } else {
          // Filtre simple (équivalence)
          query = query.eq(column, filterValue);
        }
      }

      if (orderBy) {
        query = query.order(orderBy, { ascending });
      }

      query = query.range(offset, offset + requestedLimit - 1);

      const { data, error } = await query;

      if (error) {
        logSupabaseError('[supabaseSelectWithFilters]', error);
        throw error;
      }

      return data || [];
    }

    // Si la limite demandée est > 1000, on fait plusieurs requêtes avec pagination
    while (allResults.length < requestedLimit) {
      const remaining = requestedLimit - allResults.length;
      const currentLimit = Math.min(remaining, MAX_SUPABASE_LIMIT);

      let query = supabaseClient
        .from(table)
        .select('*');

      // Appliquer tous les filtres
      for (const [column, filterValue] of Object.entries(filters)) {
        // Si le filtre est un objet avec op (ex: { op: 'ilike', value: 'xxx' })
        if (typeof filterValue === 'object' && filterValue.op && filterValue.value) {
          if (filterValue.op === 'ilike') {
            query = query.ilike(column, `%${filterValue.value}%`);
          } else if (filterValue.op === 'eq') {
            query = query.eq(column, filterValue.value);
          }
        } else {
          // Filtre simple (équivalence)
          query = query.eq(column, filterValue);
        }
      }

      if (orderBy) {
        query = query.order(orderBy, { ascending });
      }

      query = query.range(offset, offset + currentLimit - 1);

      const { data, error } = await query;

      if (error) {
        logSupabaseError('[supabaseSelectWithFilters]', error);
        throw error;
      }

      if (!data || data.length === 0) {
        // Plus de données disponibles
        break;
      }

      allResults.push(...data);
      offset += currentLimit;

      // Si on a récupéré moins que la limite demandée, c'est qu'il n'y a plus de données
      if (data.length < currentLimit) {
        break;
      }
    }

    return allResults.slice(0, requestedLimit);
  } catch (error) {
    logSupabaseError('[supabaseSelectWithFilters]', error);
    return [];
  }
}

export default {
  supabaseSelect,
  supabaseInsert,
  supabaseUpdate,
  supabaseSelectWithFilters
};

