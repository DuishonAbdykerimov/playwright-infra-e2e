// scripts/ai/ai-reporter.js
import { OpenAI } from 'openai';
import { getOpenRouterApiKey } from './openrouter-config.js';

class AiReporter {
  async onTestEnd(test, result) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      let apiKey;
      try {
        apiKey = getOpenRouterApiKey();
      } catch (error) {
        console.error(`[AI Engine] ${error.message}`);
        return false;
      }

      if (!apiKey) {
        console.warn('[AI Engine] Set OPENROUTER_API_KEY in .env or the CI secrets to enable AI analysis.');
        return false;
      }

      const sensitiveValues = [
        process.env.ECOM_USER_EMAIL,
        process.env.ECOM_USER_PASSWORD,
        apiKey,
      ].filter(Boolean);
      const redactSensitiveValues = value => sensitiveValues.reduce(
        (redacted, sensitiveValue) => redacted.split(sensitiveValue).join('[REDACTED]'),
        value,
      );
      const errorMessage = redactSensitiveValues((result.errors ?? [])
        .map(error => error.message ?? '')
        .join('\n'));

      console.log(`\n🤖 [AI Engine]: Тест "${redactSensitiveValues(test.title)}" упал! Анализирую ошибку...`);

      try {
        const openai = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });
        const completion = await openai.chat.completions.create({
          model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
          max_tokens: 600,
          messages: [
            {
              role: 'system',
              content: 'Ты Senior QA Automation и архитектор. Проанализируй ошибку Playwright, кратко определи вероятную причину и предложи конкретные шаги диагностики или исправления. Не утверждай, что исправление проверено.',
            },
            {
              role: 'user',
              content: `Тест: ${test.title}\nФайл: ${test.location.file}\nСтрока: ${test.location.line}\n\nОшибка:\n${errorMessage}`,
            },
          ],
        });

        const analysis = completion.choices[0]?.message?.content;
        if (!analysis) {
          const finishReason = completion.choices[0]?.finish_reason ?? 'unknown';
          throw new Error(`The AI provider returned no analysis (finish_reason: ${finishReason}).`);
        }

        console.log('\n======================================================');
        console.log('✨ [AI Engine] АНАЛИЗ ОШИБКИ:');
        console.log('======================================================');
        console.log(redactSensitiveValues(analysis));
        console.log('======================================================\n');
        return true;
      } catch (error) {
        const details = [
          error.status ? `HTTP ${error.status}` : null,
          error.code ? `code ${error.code}` : null,
          error.message,
        ].filter(Boolean).join(' — ');
        console.error('[AI Engine] Could not analyze the test failure:', redactSensitiveValues(details));
        return false;
      }
    }

    return true;
  }
}

export default AiReporter;
