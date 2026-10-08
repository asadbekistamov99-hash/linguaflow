'use strict';

// Providers read their keys from the environment only; nothing is stored in code or the database.
const PROVIDERS = {
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    async call({ key, system, messages, signal }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.TUTOR_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 400, system, messages }),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const d = await r.json();
      return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  },
  openai: {
    key: () => process.env.OPENAI_API_KEY,
    async call({ key, system, messages, signal }) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.TUTOR_MODEL || 'gpt-4o-mini', max_tokens: 400, messages: [{ role: 'system', content: system }, ...messages] }),
      });
      if (!r.ok) throw new Error(`openai ${r.status}`);
      const d = await r.json();
      return d.choices?.[0]?.message?.content || '';
    },
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY,
    async call({ key, system, messages, signal }) {
      const model = process.env.TUTOR_MODEL || 'gemini-2.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: 400 },
        }),
      });
      if (!r.ok) throw new Error(`gemini ${r.status}`);
      const d = await r.json();
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
};

// AI_PROVIDER picks one explicitly; otherwise the first provider that has a key is used.
function activeProvider() {
  const want = (process.env.AI_PROVIDER || '').toLowerCase();
  if (want && PROVIDERS[want]) return PROVIDERS[want].key() ? want : null;
  return Object.keys(PROVIDERS).find((n) => PROVIDERS[n].key()) || null;
}

async function ask({ system, messages }) {
  const name = activeProvider();
  if (!name) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const text = (await PROVIDERS[name].call({ key: PROVIDERS[name].key(), system, messages, signal: ctrl.signal })).trim();
    if (!text) throw new Error(`${name}: empty reply`);
    return text;
  } finally { clearTimeout(timer); }
}

module.exports = { ask, activeProvider };
