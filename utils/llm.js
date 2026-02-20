import dotenv from 'dotenv';

dotenv.config();

/** appelle un LLM local (Ollama par défaut) avec system + user prompt */
export async function localLlmRequest(systemPrompt, userPrompt, temperature = 0.5, maxTokens = 100) {
  const baseUrl =
    process.env.LOCAL_LLM_BASE_URL ||
    (process.env.OLLAMA_HOST?.startsWith('http') ? process.env.OLLAMA_HOST : undefined) ||
    'http://127.0.0.1:11434';

  const model = process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b-instruct-q4_K_M';

  const url = new URL('/api/chat', baseUrl).toString();

  const options = {};
  if (Number.isFinite(temperature)) options.temperature = temperature;
  if (Number.isFinite(maxTokens)) options.num_predict = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options,
    }),
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${txt}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  }

  const text =
    data?.message?.content ??
    data?.response ??
    data?.choices?.[0]?.message?.content ??
    'Erreur lors de la récupération de la réponse';

  return String(text);
}

// ============================================================================
//  Pod LLM (Runpod vLLM) - configuration in-memory
// ============================================================================
let _podLlmConfig = {
  podId: null,
  baseUrl: null,
  apiKey: null,
  model: null,
};

/**
 * Configure le Pod LLM sans dépendre des variables d'environnement.
 * Utile pour injecter le `podId` depuis une config applicative.
 */
export function configurePodLlm(config = {}) {
  _podLlmConfig = {
    ..._podLlmConfig,
    ...config,
  };
}

/**
 * appelle un LLM sur un pod Runpod (vLLM OpenAI-compatible) avec system + user prompt
 */
export async function podLlmRequest(systemPrompt, userPrompt, temperature = 0.5, maxTokens = 100) {
  const podId = _podLlmConfig.podId;
  if (!podId) {
    throw new Error('podLlmRequest: podId manquant. Configure via configurePodLlm({ podId }).');
  }

  const baseUrl = _podLlmConfig.baseUrl || `https://${podId}-8000.proxy.runpod.net`;
  const apiKey = _podLlmConfig.apiKey || `sk-${podId}`;
  const model = _podLlmConfig.model;
  if (!model) {
    throw new Error('podLlmRequest: model manquant. Configure via configurePodLlm({ model }).');
  }

  const url = new URL('/v1/chat/completions', baseUrl).toString();

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (Number.isFinite(temperature)) body.temperature = temperature;
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${txt}`);
  }

  const data = await response.json();
  if (data?.error) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || JSON.stringify(data.error);
    throw new Error(msg);
  }

  const text = data?.choices?.[0]?.message?.content ?? 'Erreur lors de la récupération de la réponse';
  return String(text);
}
