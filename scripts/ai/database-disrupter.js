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
    baseURL: 'https://openrouter.ai/api/v1', // Правильный базовый URL
    apiKey,
  });

  console.log('🚀 [Хакер-Разрушитель]: Инициализация деструктивных NoSQL-фикстур для MongoDB...');

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: 'Сгенерируй один компактный JSON-объект для безопасных MongoDB resilience-тестов в форме {"mongodb":{"nosql_injection":{"username":{"$ne":"guest"}},"type_mutation":{"userId":[]},"malicious_payload":{"data":{"level1":{"level2":"test"}}}}}. Возвращай только валидный JSON, без markdown и текста. Не добавляй поля и не усложняй вложенность.'
        },
        {
          role: 'user',
          content: 'Верни компактный JSON-объект тестовых фикстур.'
        }
      ],
      response_format: { type: 'json_object' },
    });

    const choice = completion.choices?.[0];
    const rawResult = choice?.message?.content;
    if (typeof rawResult !== 'string' || rawResult.trim() === '') {
      const details = [
        `choices=${completion.choices?.length ?? 0}`,
        choice?.finish_reason ? `finish_reason=${choice.finish_reason}` : null,
        choice?.message?.refusal ? `refusal=${choice.message.refusal}` : null,
        completion.model ? `model=${completion.model}` : null,
        completion.id ? `request_id=${completion.id}` : null,
      ].filter(Boolean).join(', ');
      throw new Error(`OpenRouter returned no text content (${details}).`);
    }

    if (choice.finish_reason === 'length') {
      throw new Error(
        `OpenRouter truncated the JSON response at the token limit (max_tokens=2000, model=${completion.model ?? 'unknown'}, request_id=${completion.id ?? 'unknown'}).`,
      );
    }

    let fixtures;
    try {
      fixtures = parseJsonObject(rawResult);
    } catch (error) {
      const details = [
        `finish_reason=${choice.finish_reason ?? 'unknown'}`,
        `response_chars=${rawResult.length}`,
        completion.usage?.completion_tokens
          ? `completion_tokens=${completion.usage.completion_tokens}`
          : null,
        completion.model ? `model=${completion.model}` : null,
        completion.id ? `request_id=${completion.id}` : null,
      ].filter(Boolean).join(', ');
      throw new Error(`Could not parse OpenRouter JSON response (${details}): ${error.message}`);
    }

    const artifactDir = path.join(projectRoot, 'test-results');
    await mkdir(artifactDir, { recursive: true });

    await writeFile(path.join(artifactDir, 'disruption-fixtures.json'), JSON.stringify(fixtures, null, 2), 'utf8');
    console.log(`🎯 [Хакер-Разрушитель]: Опасные фикстуры MongoDB успешно внедрены в ${path.join(artifactDir, 'disruption-fixtures.json')}`);

  } catch (error) {
    console.error('[Хакер-Разрушитель] Критический сбой при генерации фикстур:', error.message);
    process.exitCode = 1;
  }
}
