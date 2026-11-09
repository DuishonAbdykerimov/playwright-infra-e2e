import { OpenAI } from 'openai';
import { Client } from 'pg';
import { getOpenRouterApiKey } from './openrouter-config.js';
import fs from 'node:fs';
import path from 'node:path';

const EMBEDDING_DIMENSIONS = 768;

async function retrieveProjectContext(openai, errorMessage) {
  const embeddingResponse = await openai.embeddings.create({
    model: process.env.OPENROUTER_EMBEDDING_MODEL || 'google/gemini-embedding-001',
    input: errorMessage,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const embedding = embeddingResponse.data?.[0]?.embedding;

  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS
    || embedding.some(value => !Number.isFinite(value))) {
    throw new Error(`RAG embedding must contain ${EMBEDDING_DIMENSIONS} finite dimensions.`);
  }

  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'qa_user',
    password: process.env.POSTGRES_PASSWORD || 'qa_password123',
    database: process.env.POSTGRES_DB || 'ecom_test_db',
  });

  try {
    await client.connect();
    const result = await client.query(
      'SELECT content FROM knowledge_base ORDER BY embedding <=> $1::vector LIMIT 1',
      [`[${embedding.join(',')}]`],
    );
    const context = result.rows[0]?.content;
    if (!context) {
      throw new Error('No matching context found in the knowledge_base table.');
    }
    return context;
  } finally {
    await client.end();
  }
}

class AiReporter {
  async onTestEnd(test, result) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      let apiKey;
      try {
        apiKey = getOpenRouterApiKey();
      } catch (error) {
        console.error(`[AI Multi-Agent] ${error.message}`);
        return;
      }

      if (!apiKey) return;

      const errorMessage = (result.errors || []).map(e => e.message || '').join('\n');
      const testFilePath = test.location.file;

      console.log(`\n🤖 [AI Orchestrator]: Тест упал в файле: ${testFilePath}`);
      console.log(`🚀 [AI Orchestrator]: Разворачиваю автономную команду из 3 ИИ-агентов...`);

      let testCode = '';
      try {
        testCode = fs.readFileSync(testFilePath, 'utf8');
      } catch (err) {
        console.error('[AI Orchestrator] Не удалось прочитать файл теста:', err.message);
        return;
      }

      try {
        const openai = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });

        const modelName = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

        console.log('\n📚 [RAG]: Ищу релевантную документацию для ошибки теста...');
        const knowledgeContext = await retrieveProjectContext(openai, errorMessage);
        const ragPromptContext = `CONTEXT FROM PROJECT KNOWLEDGE BASE:\n${knowledgeContext}`;
        console.log('📚 [RAG]: Релевантный контекст найден.');

        // ===================================================
        // 🕵️‍♂️ АГЕНТ 1: QA Analyst Agent (Технический Анализ)
        // ===================================================
        console.log(`\n🕵️‍♂️ [Агент 1 - QA Analyst]: Изучаю логи Playwright и локализую причину сбоя...`);

        const qaAnalystResponse = await openai.chat.completions.create({
          model: modelName,
          max_tokens: 800, // Жесткий лимит для прохождения по бесплатной квоте
          messages: [
            {
              role: 'system',
              content: 'Ты — ИИ-агент "QA Analyst". Твоя задача — изучить лог падения теста Playwright, сопоставить его с кодом и написать краткое техническое заключение: какая строка упала, почему ожидания не совпали и что конкретно нужно исправить.'
            },
            {
              role: 'user',
              content: `${ragPromptContext}\n\nОШИБКА:\n${errorMessage}\n\nКОД ТЕСТА:\n${testCode}`
            }
          ]
        });

        const qaReport = qaAnalystResponse.choices?.[0]?.message?.content;
        if (!qaReport) throw new Error('Агент-Аналитик вернул пустой отчет.');
        console.log(`📝 [QA Analyst] Технический отчет подготовлен.`);

        // ===================================================
        // 🛠️ АГЕНТ 2: Senior Developer Agent (Генерация кода)
        // ===================================================
        console.log(`\n🛠️ [Агент 2 - Senior Developer]: Принимаю отчет аналитика. Пишу патч кода...`);

        const developerResponse = await openai.chat.completions.create({
          model: modelName,
          max_tokens: 1200, // Лимит на генерацию кода
          messages: [
            {
              role: 'system',
              content: 'Ты — ИИ-агент "Senior Developer". Ты получаешь код теста и отчет от QA Analyst. Твоя задача — исправить код теста так, чтобы устранить ошибку. Возвращай ТОЛЬКО исправленный полный код файла без markdown оберток.'
            },
            {
              role: 'user',
              content: `${ragPromptContext}\n\nОРИГИНАЛЬНЫЙ КОД:\n${testCode}\n\nОТЧЕТ ОТ QA ANALYST:\n${qaReport}`
            }
          ]
        });

        const draftCode = developerResponse.choices?.[0]?.message?.content;
        if (!draftCode) throw new Error('Агент-Разработчик вернул пустой черновик.');
        console.log(`💻 [Senior Developer] Черновик исправленного кода сгенерирован.`);

        // ===================================================
        // 🛡️ АГЕНТ 3: Security & Compliance Agent (Валидация)
        // ===================================================
        console.log(`\n🛡️ [Агент 3 - Security & Compliance]: Проверяю код разработчика на уязвимости, хардкод и качество...`);

        const securityResponse = await openai.chat.completions.create({
          model: modelName,
          max_tokens: 1200,
          messages: [
            {
              role: 'system',
              content: 'Ты — ИИ-агент "Security & Compliance Auditor". Твоя задача — проверить предложенный исправленный JavaScript-код. Убедись, что код безопасен, в нем нет захардкоженных токенов/секретов, и он синтаксически корректен. Верни финальный, очищенный полный код файла. Правило: возвращай ТОЛЬКО чистый код без markdown блоков.'
            },
            {
              role: 'user',
              content: `ПРЕДЛОЖЕННЫЙ КОД ДЛЯ ПРОВЕРКИ:\n${draftCode}`
            }
          ]
        });

        let finalHealedCode = securityResponse.choices?.[0]?.message?.content;
        if (!finalHealedCode) throw new Error('Агент Безопасности вернул пустой результат.');

        finalHealedCode = finalHealedCode.replace(/^```javascript\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

        // Сохраняем результат совместной работы трех агентов
        fs.writeFileSync(testFilePath, finalHealedCode, 'utf8');

        console.log('\n======================================================================');
        console.log(`✨ [AI Self-Healing]: ТРИО АГЕНТОВ (QA -> DEV -> SECURITY) УСПЕШНО ИСПРАВИЛИ ТЕСТ!`);
        console.log(`📄 Модифицированный файл: ${testFilePath}`);
        console.log('======================================================================\n');

      } catch (error) {
        console.error('[AI Orchestrator] Сбой мультиагентной цепочки:', error.message);
      }
    }
  }
}

export default AiReporter;
