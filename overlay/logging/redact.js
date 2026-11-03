// ScapeLite logging: secret redaction. Every line passes through here before it is written, so a webhook URL, a token
// or the Windows user name can never end up in a log file, whichever plugin or module logged it.
'use strict';

const SECRET_KEY = /secret|token|webhook|passw|apikey|api_key|authorization|userkey|user_key|credential/i;

const RULES = [
  // Discord / Slack webhook URLs
  [/https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[^\s"'<>)\]]+/gi, '[webhook]'],
  [/https?:\/\/hooks\.slack\.com\/services\/[^\s"'<>)\]]+/gi, '[webhook]'],
  // Discord bot token shape
  [/\b[MNO][A-Za-z\d_-]{23,27}\.[\w-]{6}\.[\w-]{27,}\b/g, '[token]'],
  // Authorization: Bearer xxx
  [/\b(Bearer|Bot|Basic)\s+[A-Za-z0-9._~+\/=-]{12,}/g, '$1 [redacted]'],
  // key=value / key: value / "key":"value" for secret-looking keys
  [/(["']?\b(?:[\w-]*(?:secret|token|passw(?:or)?d|api[_-]?key|apikey|authorization|user[_-]?key|webhook(?:[_-]?url)?|credential)[\w-]*)\b["']?\s*[:=]\s*)(["']?)[^\s"',;&}\]]{3,}\2/gi, '$1$2[redacted]$2'],
  // Windows / unix home folders: keep the shape, drop the person
  [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1<user>'],
  [/(\/(?:Users|home)\/)[^\/\s"']+/g, '$1<user>'],
];

function redactText(s) {
  if (s == null) return '';
  let out = typeof s === 'string' ? s : String(s);
  for (let i = 0; i < RULES.length; i++) out = out.replace(RULES[i][0], RULES[i][1]);
  return out;
}

function redactData(v, depth) {
  depth = depth || 0;
  if (v == null) return v;
  if (typeof v === 'string') return redactText(v);
  if (typeof v !== 'object') return v;
  if (depth > 6) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => redactData(x, depth + 1));
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (++n > 100) { out._more = true; break; }
    out[k] = SECRET_KEY.test(k) && v[k] != null && v[k] !== '' && typeof v[k] !== 'boolean' ? '[redacted]' : redactData(v[k], depth + 1);
  }
  return out;
}

module.exports = { redactText, redactData };
