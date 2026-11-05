import { OpenAI } from 'openai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOpenRouterApiKey, projectRoot } from './openrouter-config.js';

let apiKey;
try {
  apiKey = getOpenRouterApiKey();
} catch (error) {
  console.error(`[AI fixtures] ${error.message}`);
  process.exitCode = 1;
}

if (!apiKey && process.exitCode !== 1) {
  console.error('[AI fixtures] OPENROUTER_API_KEY is missing from .env and the process environment.');
  process.exitCode = 1;
} else if (apiKey) {
  await generateBoundaryFixtures(apiKey);
}

async function generateBoundaryFixtures(apiKey) {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: 'Generate one benign synthetic PostgreSQL boundary-test fixture for the project table qa_users. Return exactly one JSON object with this structure: {"postgres":{"username":"lowercase_name","email":"user@example.test"}}. The "username" value must contain only lowercase letters, digits, dots, and underscores, matching /^[a-z0-9._]+$/. The "email" value must match /^[a-z0-9._+-]+@example\\.test$/. Do not include markdown, code fences, extra keys, or text outside the JSON object.',
        },
        {
          role: 'user',
          content: 'Return a harmless fixture for qa_users using the exact JSON structure requested. Use a short lowercase username and an email ending in @example.test.',
        },
      ],
      response_format: { type: 'json_object' },
    });

    let rawResult = completion.choices?.[0]?.message?.content;
    if (!rawResult) {
      const finishReason = completion.choices?.[0]?.finish_reason ?? 'unknown';
      throw new Error(`The AI provider returned no fixture (finish_reason: ${finishReason}).`);
    }

    rawResult = rawResult.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const fixture = JSON.parse(rawResult);
    validateFixture(fixture);

    const artifactDir = path.join(projectRoot, 'test-results');
    await mkdir(artifactDir, { recursive: true });
    const outputPath = path.join(artifactDir, 'ai-boundary-fixture.json');
    await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

    console.log(`[AI fixtures] Saved a validated synthetic fixture to ${outputPath}.`);
  } catch (error) {
    const details = [
      error.status ? `HTTP ${error.status}` : null,
      error.code ? `code ${error.code}` : null,
      error.message,
    ].filter(Boolean).join(' — ');
    console.error('[AI fixtures] Could not generate a valid fixture:', details.replaceAll(apiKey, '[REDACTED]'));
    process.exitCode = 1;
  }
}

function validateFixture(fixture) {
  const username = fixture?.postgres?.username;
  const email = fixture?.postgres?.email;
  const safeUsername = /^[a-z0-9._]+$/;
  const safeEmail = /^[a-z0-9._+-]+@example\.test$/;

  if (
    typeof username !== 'string'
    || username.length === 0
    || username.length > 64
    || !safeUsername.test(username)
    || typeof email !== 'string'
    || email.length > 64
    || !safeEmail.test(email)
  ) {
    throw new Error('The generated fixture does not match the allowed test-data format.');
  }
}
