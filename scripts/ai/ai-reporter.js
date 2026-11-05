import { OpenAI } from 'openai';
import { getOpenRouterApiKey } from './openrouter-config.js';
import fs from 'node:fs';
import path from 'node:path';

class AiReporter {
  async onTestEnd(test, result) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      let apiKey;
      try {
        apiKey = getOpenRouterApiKey();
      } catch (error) {
        console.error(`[AI Engine] \${error.message}`);
        return;
      }

      if (!apiKey) return;

      const errorMessage = (result.errors ?? []).map(e => e.message ?? '').join('\n');
      const testFilePath = test.location.file;

      console.log(`\n🤖 [AI Self-Healing]: Тест упал в файле: ${testFilePath}. Запускаю режим авто-исправления кода...`);

      // Читаем исходный код упавшего теста
      let testCode = '';
      try {
        testCode = fs.readFileSync(testFilePath, 'utf8');
      } catch (err) {
        console.error('[AI Self-Healing] Не удалось прочитать файл теста:', err.message);
        return;
      }

      try {
        const openai = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });

        const completion = await openai.chat.completions.create({
          model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content: `Ты — ИИ-архитектор автоматизации тестирования с функцией Self-Healing (самоисцеление кода).
              Тебе дан исходный код файла теста на JavaScript/Playwright и текст ошибки, из-за которой он упал.
              Твоя задача — ПЕРЕПИСАТЬ код теста так, чтобы исправить ошибку (например, поправить неактуальное ожидание, обновить локатор или добавить обработку деструктивных данных от Хакера-Разрушителя).
              Правила:
              1. Возвращай ТОЛЬКО исправленный полный код файла.
              2. Никакого лишнего текста, пояснений или markdown-оберток (\`\`\`javascript). Только чистый исполняемый код.`
            },
            {
              role: 'user',
              content: `ФАЙЛ: ${testFilePath}\n\nОШИБКА:\n${errorMessage}\n\nОРИГИНАЛЬНЫЙ КОД ТЕСТА:\n${testCode}`
            }
          ]
        });

        let healedCode = completion.choices[0]?.message?.content;
        if (!healedCode) throw new Error('ИИ вернул пустой код исправления.');

        // Очищаем от возможных markdown-тегов
        healedCode = healedCode.replace(/^```javascript\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

        // Перезаписываем файл теста исправленным кодом!
        fs.writeFileSync(testFilePath, healedCode, 'utf8');
        
        console.log('\n======================================================');
        console.log(`✨ [AI Self-Healing] ТЕСТ УСПЕШНО ИСПРАВЛЕН И ПЕРЕЗАПИСАН!`);
        console.log(`📄 Измененный файл: ${testFilePath}`);
        console.log('======================================================\n');

      } catch (error) {
        console.error('[AI Self-Healing] Не удалось автоматически исправить код:', error.message);
      }
    }
  }
}

export default AiReporter;
