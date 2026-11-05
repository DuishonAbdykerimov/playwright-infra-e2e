import { test, expect } from '@playwright/test';
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
