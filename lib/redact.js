// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — secret redaction (credential masking unit).
 *
 * A registry of credential patterns plus a pure reduce that rewrites every
 * match to a `[redacted:<name>]` marker. The fold (`lib/fold.js`) runs every
 * prompt, tool argument and answer through it before storing the turn digest.
 *
 * Every value character class excludes `[` and `]`, which is what makes
 * redaction idempotent: an inserted marker can never be re-matched by a later
 * row or a second pass. Drop one exclusion and the output eats itself,
 * `[redacted:secret]` becoming `[redacted:[redacted:secret]]`.
 */

/** Credential patterns, applied in table order; `replace` overrides the default marker. */
export const SECRET_PATTERNS = [
  {
    name: 'private-key',
    re: /-----BEGIN[^\n]*?PRIVATE KEY-----[\s\S]*?-----END[^\n]*?PRIVATE KEY-----/g,
  },
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { name: 'github-token', re: /\bgithub_pat[_][A-Za-z0-9_]{20,}/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { name: 'api-key', re: /\bsk-(?:[A-Za-z0-9]+-)?[A-Za-z0-9_-]{20,}/g },
  {
    name: 'url-password',
    re: /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@\[\]]+:)[^\s:/@\[\]]+@/g,
    replace: '$1[redacted:url-password]@',
  },
  {
    name: 'bearer-token',
    re: /\bBearer\s+[A-Za-z0-9\-._~+/=]{16,}/g,
    replace: 'Bearer [redacted:bearer-token]',
  },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  {
    name: 'secret',
    re: /(?<![A-Za-z0-9])(api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|token)(["']?[ \t]*[:=][ \t]*["']?)((?=[^\s"'\[\]]*[0-9])[^\s"'\[\]]{8,}|[^\s"'\[\]]{16,})/gi,
    replace: '$1$2[redacted:secret]',
  },
]

/** Mask every known credential shape in `text`; non-string input yields `''`. */
export function redactSecrets(text) {
  if (typeof text !== 'string') return ''
  return SECRET_PATTERNS.reduce(
    (out, { name, re, replace }) => out.replace(re, replace ?? `[redacted:${name}]`),
    text,
  )
}
