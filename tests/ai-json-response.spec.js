import { test, expect } from '@playwright/test';
import { normalizeDisruptionFixtures } from '../scripts/ai/normalize-disruption-fixtures.js';
import { parseJsonObject } from '../scripts/ai/parse-json-object.js';

test('parses JSON followed by extra response text', () => {
  const fixtures = { postgres: { username: 'test_user' }, mongodb: { nested: true } };

  expect(parseJsonObject(`${JSON.stringify(fixtures)}Unexpected trailing text`)).toEqual(fixtures);
});

test('ignores braces inside JSON strings when finding the object boundary', () => {
  const fixtures = { mongodb: { payload: 'text with } and { inside' } };

  expect(parseJsonObject(`\`\`\`json\n${JSON.stringify(fixtures)}\n\`\`\`\nextra`)).toEqual(fixtures);
});

test('rejects a response without a complete JSON object', () => {
  expect(() => parseJsonObject('{"postgres":')).toThrow('incomplete JSON object');
});

test('normalizes an oversized PostgreSQL username to the 64-character boundary', () => {
  const fixtures = normalizeDisruptionFixtures({
    postgres: { username: 'a'.repeat(75), email: 'qa@example.test' },
    mongodb: { nested: true },
  });

  expect(fixtures.postgres.username).toHaveLength(64);
});

test('rejects fixtures with an invalid test email', () => {
  expect(() => normalizeDisruptionFixtures({
    postgres: { username: 'qa_user', email: 'qa@example.com' },
    mongodb: {},
  })).toThrow('ИИ вернул некорректный тестовый email.');
});