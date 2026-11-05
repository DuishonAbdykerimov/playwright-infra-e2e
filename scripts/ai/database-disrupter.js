import { OpenAI } from 'openai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOpenRouterApiKey, projectRoot } from './openrouter-config.js';
import { parseJsonObject } from './parse-json-object.js';

let apiKey;
try {
  apiKey = getOpenRouterApiKey();
} catch (error) {
  console.error(`[Хакер-Разрушитель] ${error.message}`);
  process.exitCode = 1;
}

if (apiKey) {
  await runDisruptionEngine(apiKey);
}

async function runDisruptionEngine(apiKey) {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  console.log('🚀 [Хакер-Разрушитель]: Инициализация деструктивных фикстур для MongoDB и PostgreSQL...');

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: 'You are a database stress-testing module. Generate exactly one valid JSON object containing two keys: "postgres" and "mongodb". Inside "postgres", provide an object with "username" (exactly 64 characters long) and "email" (valid @example.test string). Inside "mongodb", provide an object representing a chaotic or nested payload. Critical rule: Return ONLY valid, minified raw JSON. Do not include markdown code blocks like ```json or any trailing text.'
        },
        {
          role: 'user',
          content: 'Generate the valid JSON disruption fixtures object.'
        }
      ],
      response_format: { type: 'json_object' },
    });

    const rawResult = completion.choices[0]?.message?.content;
    if (!rawResult) throw new Error('ИИ вернул пустой ответ.');

    const fixtures = parseJsonObject(rawResult);

    const artifactDir = path.join(projectRoot, 'test-results');
    await mkdir(artifactDir, { recursive: true });

    await writeFile(path.join(artifactDir, 'disruption-fixtures.json'), JSON.stringify(fixtures, null, 2), 'utf8');
    console.log(`🎯 [Хакер-Разрушитель]: Деструктивные фикстуры успешно внедрены в ${path.join(artifactDir, 'disruption-fixtures.json')}`);

  } catch (error) {
    console.error('[Хакер-Разрушитель] Критический сбой при генерации фикстур:', error.message);
    process.exitCode = 1;
  }
}
