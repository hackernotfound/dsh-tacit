// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECRET_PATTERNS, redactSecrets } from '../lib/redact.js'

// Fixtures are spliced so a secret scanner reading this file sees no credential shape.

const RSA_PEM = [
  '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu',
  'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm',
  '-----END RSA PRIVATE KEY-----',
].join('\n')

const EC_PEM = [
  '-----BEGIN EC ' + 'PRIVATE KEY-----',
  'MHcCAQEEIJ0nOa1PN4kZzKq3vRy8bXwFmT2sLdGhVuEiQpWrYsAoAoGCCqGSM49',
  'AwEHoUQDQgAEq7Vz1sXmNbPl9dRfKcT0uYhJ2wGaEoZnB4xMvS6rLtCdHiUkFyPQ',
  '-----END EC PRIVATE KEY-----',
].join('\n')

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dQw4w9WgXcQ0aBcDeFgHiJkLmNoPqRsTuVw'

test('a PEM private key block is replaced whole, newlines and all', () => {
  const input = `loading identity from ~/.ssh/id_rsa\n${RSA_PEM}\nidentity loaded`
  assert.equal(redactSecrets(input), 'loading identity from ~/.ssh/id_rsa\n[redacted:private-key]\nidentity loaded')
})

test('an AWS access key id is masked', () => {
  assert.equal(
    redactSecrets('[deploy] uploading with AKIA' + 'IOSFODNN7EXAMPLE to the artifacts bucket'),
    '[deploy] uploading with [redacted:aws-access-key-id] to the artifacts bucket',
  )
})

test('a ghp_ GitHub token is masked', () => {
  assert.equal(
    redactSecrets('[gh] using ghp_ab12CD34ef56GH78ij90KL for the release upload'),
    '[gh] using [redacted:github-token] for the release upload',
  )
})

test('a fine-grained github_pat token is masked', () => {
  assert.equal(
    redactSecrets('[gh] refreshed github_' + 'pat_11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ in the keychain'),
    '[gh] refreshed [redacted:github-token] in the keychain',
  )
})

test('a Slack bot token is masked', () => {
  assert.equal(
    redactSecrets('slack post failed with xoxb-' + '2401055723-2412754323649-7hFGkTqR2mWzYcXv8bNa1Ld0 (invalid_auth)'),
    'slack post failed with [redacted:slack-token] (invalid_auth)',
  )
})

test('a Google API key is masked inside a request line', () => {
  assert.equal(
    redactSecrets('GET https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre&key=AIza' + 'SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY 200'),
    'GET https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre&key=[redacted:google-api-key] 200',
  )
})

test('an sk- key with a vendor segment is masked', () => {
  assert.equal(
    redactSecrets('client init with sk-' + 'proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4 succeeded'),
    'client init with [redacted:api-key] succeeded',
  )
})

test('a bare sk- DeepSeek key of 32 hex chars is masked', () => {
  assert.equal(
    redactSecrets('deepseek client configured with sk-' + '3f9a2b7c1d4e6f8a0b2c4d6e8f0a1b3c from the env'),
    'deepseek client configured with [redacted:api-key] from the env',
  )
})

test('only the password is masked in a connection URL', () => {
  assert.equal(
    redactSecrets('connecting to postgres://admin:' + 's3cr3t-pass@db.internal:5432/app now'),
    'connecting to postgres://admin:' + '[redacted:url-password]@db.internal:5432/app now',
  )
})

test('a bearer token is masked and the word Bearer survives', () => {
  assert.equal(
    redactSecrets('[http] Authorization: Bearer aG9sZHRoZWRvb3JzdGVhZHkxMjM0NTY3ODkw -> 200'),
    '[http] Authorization: Bearer [redacted:bearer-token] -> 200',
  )
})

test('a JWT is masked', () => {
  assert.equal(
    redactSecrets(`session payload ${JWT} was rejected by the gateway`),
    'session payload [redacted:jwt] was rejected by the gateway',
  )
})

test('an assignment value is masked and the key and separator survive', () => {
  assert.equal(
    redactSecrets('startup config api_key=hunter2hunter2 loaded'),
    'startup config api_key=[redacted:secret] loaded',
  )
})

test('the assignment key is left-guarded so suffixed key names still match', () => {
  assert.equal(redactSecrets('refresh_token: 8f3d9a2b7c1e4d6f'), 'refresh_token: [redacted:secret]')
  assert.equal(redactSecrets('my_api_key=aB3dEf9hJk2mNp'), 'my_api_key=[redacted:secret]')
})

test('an earlier row wins: a bearer JWT never reaches the jwt row', () => {
  assert.equal(
    redactSecrets(`Authorization: Bearer ${JWT}`),
    'Authorization: Bearer [redacted:bearer-token]',
  )
})

test('an earlier row wins: an sk- value in an assignment is an api-key, not a secret', () => {
  assert.equal(
    redactSecrets('api_key=sk-' + 'proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4'),
    'api_key=[redacted:api-key]',
  )
})

test('short and wordy assignment values are left alone', () => {
  assert.equal(redactSecrets('token = 5'), 'token = 5')
  assert.equal(redactSecrets('password: yes'), 'password: yes')
  assert.equal(redactSecrets('token = count'), 'token = count')
})

test('prose about passwords and tokens is left alone', () => {
  const prose = [
    'Tacit never stores raw credentials in the timeline.',
    'When a turn mentions a password or an access token in passing, the fold keeps the',
    'surrounding words so the digest still reads naturally.',
    'Redaction happens on the way in, so rotating a token that already leaked is still your job.',
    'Reviewers often ask whether a password typed into a prompt survives a restart, and the answer is no.',
  ].join(' ')
  assert.equal(redactSecrets(prose), prose)
})

test('ordinary URLs are left alone', () => {
  const listing = 'https://api.example.com/v1/models?limit=10'
  assert.equal(redactSecrets(listing), listing)
  const local = 'http://127.0.0.1:3080/api/tacit/state'
  assert.equal(redactSecrets(local), local)
})

test('the bare word Bearer is left alone', () => {
  const sentence = 'The Bearer scheme is described in RFC 6750 and we follow it.'
  assert.equal(redactSecrets(sentence), sentence)
})

test('a blob of mixed secrets redacts once and stays put', () => {
  const blob = [
    'startup 2026-08-31T09:12:04Z',
    EC_PEM,
    'aws id AKIA' + 'IOSFODNN7EXAMPLE',
    'Authorization: Bearer aG9sZHRoZWRvb3JzdGVhZHkxMjM0NTY3ODkw',
    'db postgres://admin:' + 's3cr3t-pass@db.internal:5432/app',
    'api_key=hunter2hunter2',
  ].join('\n')
  const once = redactSecrets(blob)
  assert.equal(once, [
    'startup 2026-08-31T09:12:04Z',
    '[redacted:private-key]',
    'aws id [redacted:aws-access-key-id]',
    'Authorization: Bearer [redacted:bearer-token]',
    'db postgres://admin:' + '[redacted:url-password]@db.internal:5432/app',
    'api_key=[redacted:secret]',
  ].join('\n'))
  assert.equal(redactSecrets(once), once)
})

test('non-string input yields the empty string', () => {
  assert.equal(redactSecrets(undefined), '')
  assert.equal(redactSecrets(null), '')
  assert.equal(redactSecrets(42), '')
  assert.equal(redactSecrets({}), '')
})

test('the pattern table keeps its order and every regex is global', () => {
  assert.deepEqual(SECRET_PATTERNS.map((p) => p.name), [
    'private-key',
    'aws-access-key-id',
    'github-token',
    'github-token',
    'slack-token',
    'google-api-key',
    'api-key',
    'url-password',
    'bearer-token',
    'jwt',
    'secret',
  ])
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(pattern.re instanceof RegExp, `${pattern.name} carries a regex`)
    assert.equal(pattern.re.global, true, `${pattern.name} is global`)
  }
})

test('an inserted marker is immune to every row, which is what makes a second pass a no-op', () => {
  for (const pattern of SECRET_PATTERNS) {
    const marker = `[redacted:${pattern.name}]`
    assert.equal(redactSecrets(marker), marker)
  }
  assert.equal(redactSecrets('api_key=[redacted:api-key]'), 'api_key=[redacted:api-key]')
  assert.equal(redactSecrets('db://admin:' + '[redacted:url-password]@host'), 'db://admin:' + '[redacted:url-password]@host')
  assert.equal(redactSecrets('Bearer [redacted:bearer-token]'), 'Bearer [redacted:bearer-token]')
  assert.equal(redactSecrets('refresh_token: [redacted:secret]'), 'refresh_token: [redacted:secret]')
})

test('a quoted assignment value is masked and both quotes survive', () => {
  assert.equal(redactSecrets('{"access_token": "aB3dEf9hIjKlMnOp"}'), '{"access_token": "[redacted:secret]"}')
  assert.equal(redactSecrets("client_secret='Zx9Yw8" + "Vu7Ts6Rq5P'"), "client_secret='[redacted:" + "secret]'")
  assert.equal(redactSecrets('PASSWORD="hunter2' + 'hunter2"'), 'PASSWORD="[redacted:' + 'secret]"')
})

test('an AWS key id is masked even without a word boundary before it', () => {
  assert.equal(redactSecrets('prefixAKIA' + 'IOSFODNN7EXAMPLE'), 'prefix[redacted:aws-access-key-id]')
})
