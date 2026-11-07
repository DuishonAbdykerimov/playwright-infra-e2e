import { OpenAI } from 'openai';
import { getOpenRouterApiKey } from './openrouter-config.js';
import { Client } from 'pg';

// Используем настройки подключения к твоей базе PostgreSQL
const pgConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'postgres',
};

async function runPerformanceAnalyzer() {
  console.log('📊 [Observability Engine]: Prometheus зафиксировал падение скорости обработки БД (Query latency > 500ms)...');

  let apiKey;
  try {
    apiKey = getOpenRouterApiKey();
  } catch (error) {
    console.error(`[Observability Engine] Ошибка токена: ${error.message}`);
    return;
  }

  if (!apiKey) {
    console.warn('[Observability Engine] OPENROUTER_API_KEY не задан.');
    return;
  }

  // Медленный SQL-запрос, который вызвал алерт в Prometheus (для примера — тяжелый поиск пользователей по тексту)
  const problematicQuery = "SELECT * FROM qa_users WHERE email LIKE '%@example.test' AND username = 'hacker_vibe' ORDER BY id DESC;";

  console.log(`🔍 [Observability Engine]: Подключаюсь к PostgreSQL для сбора плана выполнения (EXPLAIN ANALYZE)...`);

  const client = new Client(pgConfig);
  let explainPlan = '';

  try {
    await client.connect();

    // Запускаем EXPLAIN ANALYZE перед проблемным запросом, чтобы вытащить системные метрики PostgreSQL
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${problematicQuery}`);
    explainPlan = res.rows.map(row => row['QUERY PLAN']).join('\n');

    console.log('📝 План выполнения (EXPLAIN PLAN) успешно собран со слоя базы данных.');
  } catch (err) {
    console.warn('⚠️ [Observability Engine]: База пуста или таблицы qa_users еще нет. Использую синтетический тяжелый план для проверки ИИ...');
    // Фоллбек-план на случай, если таблица еще не создана
    explainPlan = `Sort  (cost=25.34..25.35 rows=1 width=104) (actual time=45.12..45.13 rows=1 loops=1)
  Sort Key: id DESC
  Sort Method: quicksort  Memory: 25kB
  ->  Seq Scan on qa_users  (cost=0.00..25.33 rows=1 width=104) (actual time=12.45..42.18 rows=1 loops=1)
        Filter: ((email ~~ '%@example.test'::text) AND (username = 'hacker_vibe'::text))
        Rows Removed by Filter: 99999
Planning Time: 0.231 ms
Execution Time: 45.412 ms`;
  } finally {
    await client.end();
  }

  console.log('🤖 [Observability Engine]: Отправляю план выполнения в Gemini для автоматической оптимизации...');

  try {
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 1500,
      messages: [
        {
          role: 'system',
          content: 'Ты — Senior Database Administrator (DBA) и архитектор баз данных PostgreSQL. Тебе дан медленный SQL-запрос и его план выполнения EXPLAIN ANALYZE. Проанализируй узкие места (например, Seq Scan, тяжелая сортировка Sort Key). Выдай краткий профессиональный разбор проблемы и напиши ТОЧНЫЙ SQL-скрипт для исправления производительности (например, CREATE INDEX с правильными полями).'
        },
        {
          role: 'user',
          content: `МЕДЛЕННЫЙ ЗАПРОС:\n${problematicQuery}\n\nПЛАН ВЫПОЛНЕНИЯ (EXPLAIN ANALYZE):\n${explainPlan}`
        }
      ]
    });

    const analysis = completion.choices?.[0]?.message?.content;
    if (!analysis) throw new Error('ИИ вернул пустой ответ.');

    console.log('\n======================================================================');
    console.log('✨ [AI Observability]: РЕКОМЕНДАЦИЯ ПО ИСПРАВЛЕНИЮ ПРОИЗВОДИТЕЛЬНОСТИ БАЗЫ ДАННЫХ:');
    console.log('======================================================================');
    console.log(analysis);
    console.log('======================================================================\n');

  } catch (error) {
    console.error('[Observability Engine] Сбой ИИ-анализатора:', error.message);
  }
}

runPerformanceAnalyzer();
