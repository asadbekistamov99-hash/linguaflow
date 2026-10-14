'use strict';

// Providers read their keys from the environment only; nothing is stored in code or the database.
const PROVIDERS = {
  gemini: {
    key: () => process.env.GEMINI_API_KEY,
    async call({ key, system, messages, signal, maxTokens = 400, json = false }) {
      const model = process.env.TUTOR_MODEL || 'gemini-2.5-flash';
      const doReq = async () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json', ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } : {}) },
        }),
      });
      let r = await doReq();
      if (!r.ok && r.status === 503) {
        await new Promise((res) => setTimeout(res, 800));
        r = await doReq();
      }
      if (!r.ok) throw new Error(`gemini ${r.status}`);
      const d = await r.json();
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
  openai: {
    key: () => process.env.OPENAI_API_KEY,
    async call({ key, system, messages, signal, maxTokens = 400, json = false }) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.TUTOR_MODEL || 'gpt-4o-mini', max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: system }, ...messages] }),
      });
      if (!r.ok) throw new Error(`openai ${r.status}`);
      const d = await r.json();
      return d.choices?.[0]?.message?.content || '';
    },
  },
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    async call({ key, system, messages, signal, maxTokens = 400 }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.TUTOR_MODEL || 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages }),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const d = await r.json();
      return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  },
};

// Available providers ordered with preference
function availableProviders() {
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase();
  if (explicit && PROVIDERS[explicit] && PROVIDERS[explicit].key()) return [explicit];
  return Object.keys(PROVIDERS).filter((n) => PROVIDERS[n].key());
}

function activeProvider() {
  const list = availableProviders();
  return list[0] || null;
}

// opts.json asks for a strict JSON reply (grading); opts.maxTokens/timeoutMs raise the defaults for long answers.
async function ask({ system, messages, maxTokens, json, timeoutMs }) {
  const providers = availableProviders();
  if (!providers.length) return null;

  let lastError = null;
  for (const name of providers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    try {
      const text = (await PROVIDERS[name].call({ key: PROVIDERS[name].key(), system, messages, signal: ctrl.signal, maxTokens, json })).trim();
      if (text) return text;
    } catch (e) {
      lastError = e;
      console.warn(`[tutor] provider ${name} failed: ${e.message}, trying next...`);
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError) throw lastError;
  return null;
}

module.exports = { ask, activeProvider };
