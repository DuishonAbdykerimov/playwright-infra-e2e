// scripts/ai/ai-reporter.js
import { OpenAI } from 'openai';

// Инициализируем ИИ напрямую через OpenRouter (доступ к любым LLM: Gemini, GPT-4o)
const openai = new OpenAI({
  baseURL: "https://openrouter.ai",
  apiKey: process.env.OPENROUTER_API_KEY // Ключ будет браться из .env или GitHub Secrets
});

class AiReporter {
  async onTestEnd(test, result) {
    // Срабатывает только если тест упал или отвалился по таймауту
    if (result.status === 'failed' || result.status === 'timedOut') {
      const errorMessage = result.errors.map(e => e.message).join('\n');
      
      console.log(`\n🤖 [AI Engine]: Тест "${test.title}" упал! Начинаю прямой анализ логов...`);

      if (!process.env.OPENROUTER_API_KEY) {
        console.log("❌ [AI Engine]: Ошибка: Переменная OPENROUTER_API_KEY не задана в окружении.");
        return;
      }

      try {
        const completion = await openai.chat.completions.create({
          model: "google/gemini-2.5-flash", // Быстрая, точная и ультрадешевая модель для кода
          messages: [
            { 
              role: "system", 
              content: "Ты Senior QA Automation и Архитектор. Изучи ошибку выполнения теста Playwright. Определи корень проблемы (ошибка локатора, баг бэкенда, упал Redis/Postgres, таймаут очереди RabbitMQ). Выведи краткое резюме ошибки и готовый исправленный кусок кода автотеста или бэкенда." 
            },
            { 
              role: "user", 
              content: `Тест: ${test.title}\nФайл: ${test.location.file}\nСтрока: ${test.location.line}\n\nОшибка:\n${errorMessage}` 
            }
          ],
        });

        console.log('\n======================================================');
        console.log('✨ [AI Engine] ВЕРДИКТ И ВАРИАНТ ИСПРАВЛЕНИЯ:');
        console.log('======================================================');
        console.log(completion.choices.message.content);
        console.log('======================================================\n');

      } catch (error) {
        console.error('❌ [AI Engine]: Не удалось достучаться до API ИИ:', error.message);
      }
    }
  }
}

export default AiReporter;
