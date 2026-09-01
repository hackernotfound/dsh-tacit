// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES, redactFinding, scanLines } from '../scripts/check-ci-logs.mjs'

// Fixtures are spliced so a secret scanner reading this file sees no credential shape.

function rulesFor(line) {
  return scanLines([line]).map((finding) => finding.rule)
}

test('an AWS access key id fires', () => {
  assert.deepEqual(rulesFor('[deploy] uploading with AKIA' + 'IOSFODNN7EXAMPLE to the bucket'), ['aws-key'])
})

test('a ghp_ GitHub token fires', () => {
  assert.deepEqual(rulesFor('[gh] using gh' + 'p_ab12CD34ef56GH78ij90KL for the release upload'), ['github-token'])
})

test('a fine-grained github_pat token fires', () => {
  assert.deepEqual(rulesFor('[gh] refreshed github_' + 'pat_11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ'), ['github-token'])
})

test('an npm automation token fires', () => {
  assert.deepEqual(rulesFor('npm publish with npm' + '_aB3dEf9hJk2mNp5qRs8tUv1wXy4zAb7c'), ['npm-token'])
})

test('an sk- model key fires', () => {
  assert.deepEqual(rulesFor('client init with sk-' + 'proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4 succeeded'), ['openai-key'])
})

test('a JWT fires', () => {
  const jwt = 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.' + 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.dQw4w9WgXcQ'
  assert.deepEqual(rulesFor('gateway rejected ' + jwt), ['jwt'])
})

test('a PEM private key header fires', () => {
  assert.deepEqual(rulesFor('-----BEGIN RSA ' + 'PRIVATE KEY-----'), ['private-key'])
})

test('a token in a query string fires', () => {
  assert.deepEqual(rulesFor('GET https://api.example.com/v1/runs?api_key=' + 'a1b2c3d4e5f6 200'), ['url-token'])
})

test('an unmasked authorization header fires', () => {
  assert.deepEqual(rulesFor('authorization: bearer ' + 'aG9sZHRoZWRvb3JzdGVhZHkxMjM0NTY3ODkw'), ['auth-header'])
})

test('an email address fires', () => {
  assert.deepEqual(rulesFor('git config user.email ' + 'someone' + '@' + 'example.com'), ['email'])
})

test('a developer home path fires on macOS, Linux and Windows', () => {
  assert.deepEqual(rulesFor('reading /Users/' + 'realname' + '/code/dsh-tacit/lib/fold.js'), ['home-path'])
  assert.deepEqual(rulesFor('reading /home/' + 'realname' + '/code/dsh-tacit/lib/fold.js'), ['home-path'])
  assert.deepEqual(rulesFor('reading C:\\Users\\' + 'realname' + '\\code\\dsh-tacit'), ['home-path'])
})

test('credential file contents fire', () => {
  assert.deepEqual(rulesFor('copied .credentials' + '.yaml into the throwaway home'), ['credential-file'])
  assert.deepEqual(rulesFor('anonymous-user-id: 8f3d9a2b7c1e4d6f'), ['credential-file'])
  assert.deepEqual(rulesFor('DEEPSEEK_API_KEY' + ': ' + 'a1b2c3d4e5f6g7h8'), ['credential-file'])
})

test('the benign shapes from real run logs are left alone', () => {
  assert.deepEqual(rulesFor('token: ***'), [], 'a masked token value')
  assert.deepEqual(rulesFor('GH_TOKEN: ***'), [], 'a masked env var')
  assert.deepEqual(rulesFor('/home/runner/work/_temp/git-credentials-8f3d9a2b-7c1e-4d6f-9a0b-2c4d6e8f0a1b.config'), [],
    'the credential helper file actions/checkout writes')
  assert.deepEqual(rulesFor('Secret source: Actions'), [], 'the checkout secret-source line')
  assert.deepEqual(rulesFor('registry_secrets: []'), [], 'an empty setup-node input')
  assert.deepEqual(rulesFor('CWE-916/InsufficientPasswordHash.ql'), [], 'a CodeQL query name')
  assert.deepEqual(rulesFor('a bearer token is masked and the word *** survives'), [], "one of Tacit's own test names")
  assert.deepEqual(rulesFor('prose about passwords and tokens is left alone'), [], "another of Tacit's own test names")
})

test('a masked authorization header is left alone', () => {
  assert.deepEqual(rulesFor('AUTHORIZATION: basic ***'), [])
  assert.deepEqual(rulesFor('x-api-key: ***'), [])
})

test('a github noreply commit email is left alone', () => {
  assert.deepEqual(rulesFor('Author: hackernotfound <hackernotfound@users.noreply.github.com>'), [])
})

test('a deny word fires whatever its case', () => {
  process.env.TACIT_LOG_DENY = 'someword'
  try {
    assert.deepEqual(rulesFor('committed by SomeWord on branch main'), ['deny-words'])
    assert.deepEqual(rulesFor('committed by nobody on branch main'), [])
  } finally {
    delete process.env.TACIT_LOG_DENY
  }
})

test('an unset or empty deny list matches nothing', () => {
  process.env.TACIT_LOG_DENY = ' , ,  '
  try {
    assert.deepEqual(rulesFor('committed by SomeWord on branch main'), [])
  } finally {
    delete process.env.TACIT_LOG_DENY
  }
  assert.deepEqual(rulesFor('committed by SomeWord on branch main'), [])
})

test('a finding carries the 1-based line number and the offending text', () => {
  const lines = ['setup complete', 'reading /Users/' + 'realname' + '/code', 'done']
  assert.deepEqual(scanLines(lines), [{ rule: 'home-path', line: 2, text: lines[1], match: '/Users/' + 'realname' }])
})

test('an empty log yields no findings and the input array is untouched', () => {
  assert.deepEqual(scanLines([]), [])
  const lines = ['one', 'two']
  scanLines(lines)
  assert.deepEqual(lines, ['one', 'two'])
})

test('no rule regex carries the g flag, whose lastIndex would skip lines', () => {
  for (const rule of RULES) {
    assert.equal(rule.pattern.global, false, rule.name + ' pattern is not global')
    if (rule.allow !== undefined) assert.equal(rule.allow.global, false, rule.name + ' allow is not global')
  }
})

test('a finding carries the matched span and redactFinding never repeats it', () => {
  const key = 'AKIA' + 'IOSFODNN7EXAMPLE'
  const [finding] = scanLines(['export AWS_ACCESS_KEY_ID=' + key + ' # from the runner'])
  assert.equal(finding.match, key)
  const shown = redactFinding(finding)
  assert.ok(!shown.includes(key))
  assert.equal(shown, 'export AWS_ACCESS_KEY_ID=[aws-key] # from the runner')
})

test('a deny word is redacted with its original casing located, not the lowered copy', () => {
  process.env.TACIT_LOG_DENY = 'lovelace'
  try {
    const [finding] = scanLines(['committed by Ada Lovelace today'])
    assert.equal(finding.match, 'Lovelace')
    assert.equal(redactFinding(finding), 'committed by Ada [deny-words] today')
  } finally {
    delete process.env.TACIT_LOG_DENY
  }
})
