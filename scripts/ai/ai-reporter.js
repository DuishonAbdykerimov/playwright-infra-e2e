import { OpenAI } from 'openai';
import { Client } from 'pg';
import { getOpenRouterApiKey } from './openrouter-config.js';
import fs from 'node:fs';
import { diag, DiagConsoleLogger, DiagLogLevel, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const EMBEDDING_DIMENSIONS = 768;

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const phoenixApiKey = process.env.PHOENIX_API_KEY;
const exporter = new OTLPTraceExporter({
  url: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006/v1/traces',
  headers: phoenixApiKey ? { Authorization: `Bearer ${phoenixApiKey}` } : undefined,
});
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();
const tracer = trace.getTracer('playwright-ai-reporter');

function recordCompletion(usage, agent, completion) {
  const responseUsage = completion.usage;
  const promptTokens = Number.isSafeInteger(responseUsage?.prompt_tokens)
    ? responseUsage.prompt_tokens
    : null;
  const completionTokens = Number.isSafeInteger(responseUsage?.completion_tokens)
    ? responseUsage.completion_tokens
    : null;
  const totalTokens = Number.isSafeInteger(responseUsage?.total_tokens)
    ? responseUsage.total_tokens
    : promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null;

  usage.agents.push({ agent, promptTokens, completionTokens, totalTokens });
  if (promptTokens !== null) usage.promptTokens += promptTokens;
  if (completionTokens !== null) usage.completionTokens += completionTokens;
  if (totalTokens !== null) usage.totalTokens += totalTokens;
  return completion.choices?.[0]?.message?.content;
}

function logLlmOpsSummary(usage, modelName) {
  const inputCostCents = usage.promptTokens * 0.075 / 1_000_000 * 100;
  const outputCostCents = usage.completionTokens * 0.30 / 1_000_000 * 100;

  console.log('\n📊 [LLMOps Monitor]');
  console.log(`Model: ${modelName} (estimated Gemini 2.5 Flash pricing)`);
  for (const agentUsage of usage.agents) {
    const format = value => value === null ? 'n/a' : value.toLocaleString('en-US');
    console.log(
      `${agentUsage.agent}: prompt ${format(agentUsage.promptTokens)} | `
      + `completion ${format(agentUsage.completionTokens)} | total ${format(agentUsage.totalTokens)}`,
    );
  }
  console.log(
    `TOTAL: prompt ${usage.promptTokens.toLocaleString('en-US')} | `
    + `completion ${usage.completionTokens.toLocaleString('en-US')} | `
    + `total ${usage.totalTokens.toLocaleString('en-US')}`,
  );
  console.log(
    `Estimated cost: ${(inputCostCents + outputCostCents).toFixed(6)} cents `
    + `($${((inputCostCents + outputCostCents) / 100).toFixed(8)}; `
    + `input $0.075/1M, output $0.30/1M tokens)`,
  );
}

async function retrieveProjectContext(openai, errorMessage) {
  const embeddingResponse = await tracer.startActiveSpan('RAG query embedding', {
    kind: SpanKind.CLIENT,
    attributes: {
      'openinference.span.kind': 'EMBEDDING',
      'llm.provider': 'openrouter',
      'llm.system': 'openai',
      'embedding.model_name': process.env.OPENROUTER_EMBEDDING_MODEL || 'google/gemini-embedding-001',
    },
  }, async span => {
    try {
      const response = await openai.embeddings.create({
        model: process.env.OPENROUTER_EMBEDDING_MODEL || 'google/gemini-embedding-001',
        input: errorMessage,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      if (Number.isSafeInteger(response.usage?.prompt_tokens)) {
        span.setAttribute('llm.token_count.prompt', response.usage.prompt_tokens);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return response;
    } catch (error) {
      span.setAttribute('error.type', error instanceof Error ? error.name : typeof error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'LLM request failed' });
      throw error;
    } finally {
      span.end();
    }
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
    if (!context) throw new Error('No matching context found in the knowledge_base table.');
    return context;
  } finally {
    await client.end();
  }
}

async function createTracedCompletion(agent, modelName, request) {
  return tracer.startActiveSpan(`LLM ${agent}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'openinference.span.kind': 'LLM',
      'llm.provider': 'openrouter',
      'llm.system': 'openai',
      'llm.model_name': modelName,
    },
  }, async span => {
    try {
      const completion = await request();
      const usage = completion.usage;
      const tokenCounts = {
        'llm.token_count.prompt': usage?.prompt_tokens,
        'llm.token_count.completion': usage?.completion_tokens,
        'llm.token_count.total': usage?.total_tokens,
      };

      for (const [attribute, count] of Object.entries(tokenCounts)) {
        if (Number.isSafeInteger(count)) span.setAttribute(attribute, count);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return completion;
    } catch (error) {
      span.setAttribute('error.type', error instanceof Error ? error.name : typeof error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'LLM request failed' });
      throw error;
    } finally {
      span.end();
    }
  });
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
        const usage = {
          agents: [],
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        };

        try {
          let ragPromptContext = '';
          console.log('\n📚 [RAG]: Ищу релевантную документацию для ошибки теста...');
          try {
            const knowledgeContext = await retrieveProjectContext(openai, errorMessage);
            ragPromptContext = `CONTEXT FROM PROJECT KNOWLEDGE BASE:\n${knowledgeContext}\n\n`;
            console.log('📚 [RAG]: Релевантный контекст найден.');
          } catch (error) {
            console.warn(`[RAG]: Контекст недоступен, продолжаю без RAG: ${error.message}`);
          }

          // ===================================================
        // 🕵️‍♂️ АГЕНТ 1: QA Analyst Agent (Технический Анализ)
        // ===================================================
          console.log(`\n🕵️‍♂️ [Агент 1 - QA Analyst]: Изучаю логи Playwright и локализую причину сбоя...`);

        const qaAnalystResponse = await createTracedCompletion('QA Analyst', modelName, () => openai.chat.completions.create({
          model: modelName,
          max_tokens: 800,
          messages: [
            {
              role: 'system',
              content: 'Ты — ИИ-агент "QA Analyst". Твоя задача — изучить лог падения теста Playwright, сопоставить его с кодом и написать краткое техническое заключение: какая строка упала, почему ожидания не совпали и что конкретно нужно исправить.'
            },
            {
              role: 'user',
              content: `${ragPromptContext}ОШИБКА:\n${errorMessage}\n\nКОД ТЕСТА:\n${testCode}`
            }
          ]
        }));

        const qaReport = recordCompletion(usage, 'QA Analyst', qaAnalystResponse);
        if (!qaReport) throw new Error('Агент-Аналитик вернул пустой отчет.');
        console.log(`📝 [QA Analyst] Технический отчет подготовлен.`);

        // ===================================================
        // 🛠️ АГЕНТ 2: Senior Developer Agent (Генерация кода)
        // ===================================================
        console.log(`\n🛠️ [Агент 2 - Senior Developer]: Принимаю отчет аналитика. Пишу патч кода...`);

        const developerResponse = await createTracedCompletion('Senior Developer', modelName, () => openai.chat.completions.create({
          model: modelName,
          max_tokens: 1200,
          messages: [
            {
              role: 'system',
              content: 'Ты — ИИ-агент "Senior Developer". Ты получаешь код теста и отчет от QA Analyst. Твоя задача — исправить код теста так, чтобы устранить ошибку. Возвращай ТОЛЬКО исправленный полный код файла без markdown оберток.'
            },
            {
              role: 'user',
              content: `${ragPromptContext}ОРИГИНАЛЬНЫЙ КОД:\n${testCode}\n\nОТЧЕТ ОТ QA ANALYST:\n${qaReport}`
            }
          ]
        }));

        const draftCode = recordCompletion(usage, 'Senior Developer', developerResponse);
        if (!draftCode) throw new Error('Агент-Разработчик вернул пустой черновик.');
        console.log(`💻 [Senior Developer] Черновик исправленного кода сгенерирован.`);

        // ===================================================
        // 🛡️ АГЕНТ 3: Security & Compliance Agent (Валидация)
        // ===================================================
        console.log(`\n🛡️ [Агент 3 - Security & Compliance]: Проверяю код разработчика на уязвимости, хардкод и качество...`);

        const securityResponse = await createTracedCompletion('Security & Compliance', modelName, () => openai.chat.completions.create({
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
        }));

        let finalHealedCode = recordCompletion(usage, 'Security Compliance', securityResponse);
        if (!finalHealedCode) throw new Error('Агент Безопасности вернул пустой результат.');

        finalHealedCode = finalHealedCode.replace(/^```javascript\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

        fs.writeFileSync(testFilePath, finalHealedCode, 'utf8');

        // Расчет суммарных метрик
        const u1 = qaAnalystResponse.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        const u2 = developerResponse.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        const u3 = securityResponse.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };

        const totalInput = u1.prompt_tokens + u2.prompt_tokens + u3.prompt_tokens;
        const totalOutput = u1.completion_tokens + u2.completion_tokens + u3.completion_tokens;
        const totalTokens = u1.total_tokens + u2.total_tokens + u3.total_tokens;

        const cost = ((totalInput * 0.075) / 1000000) + ((totalOutput * 0.30) / 1000000);

        console.log('\n======================================================================');
        console.log(`✨ [AI Self-Healing]: ТРИО АГЕНТОВ (QA -> DEV -> SECURITY) УСПЕШНО ИСПРАВИЛИ ТЕСТ!`);
        console.log(`📄 Модифицированный файл: ${testFilePath}`);
        console.log('----------------------------------------------------------------------');
        console.log(`📊 [LLMOps Monitor]: Суммарно потрачено токенов командой: ${totalTokens}`);
        console.log(`💵 Estimated Run Cost: $${cost.toFixed(6)}`);
        console.log('======================================================================\n');

        } catch (error) {
          console.error('[AI Orchestrator] Сбой мультиагентной цепочки:', error.message);
        } finally {
          logLlmOpsSummary(usage, modelName);
        }
      } catch (error) {
        console.error('[AI Orchestrator] Не удалось запустить LLMOps цепочку:', error.message);
      }
    }
  }

  async onEnd() {
    try {
      await provider.forceFlush();
    } catch (error) {
      console.error('[Phoenix] Не удалось отправить OTLP-трейсы:', error.message);
    }

    try {
      await provider.shutdown();
    } catch (error) {
      console.error('[Phoenix] Не удалось корректно завершить exporter:', error.message);
    }
  }
}

export default AiReporter;
