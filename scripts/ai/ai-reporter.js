import { OpenAI } from 'openai';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getOpenRouterApiKey } from './openrouter-config.js';

class AiReporter {
  constructor() {
    this.pendingRepairs = [];
  }

  onTestEnd(test, result) {
    if (result.status !== 'failed' && result.status !== 'timedOut') {
      return true;
    }

    if (result.retry < test.retries) {
      return true;
    }

    const repair = this.processFailure(test, result);
    this.pendingRepairs.push(repair);
    return repair;
  }

  async onEnd() {
    await Promise.all(this.pendingRepairs);
  }

  async processFailure(test, result) {
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

    const testFilePath = path.resolve(test.location.file);
    const testsDirectory = path.resolve('tests');
    const relativeTestPath = path.relative(testsDirectory, testFilePath);
    const canHeal = relativeTestPath !== ''
      && relativeTestPath !== '..'
      && !relativeTestPath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeTestPath)
      && testFilePath.endsWith('.js');
    const testContract = path.basename(testFilePath) === 'database-disruption.spec.js'
      ? '\nFixture contract: scripts/ai/database-disrupter.js generates a PostgreSQL username of exactly 64 characters. The correct maximum-length assertion for this test is <= 64; do not guess a smaller intermediate limit.'
      : '';

    let testCode = '';
    if (canHeal) {
      try {
        testCode = fs.readFileSync(testFilePath, 'utf8');
      } catch (error) {
        console.error('[AI Self-Healing] Could not read the failed test file:', error.message);
        return false;
      }
    }

    console.log(`\n🤖 [AI Self-Healing]: Анализирую падение теста "${redactSensitiveValues(test.title)}"...`);

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
            content: canHeal
              ? 'You are a Playwright test self-healing assistant. Return only the complete corrected JavaScript test file, with no markdown. Make the smallest evidence-based change that fixes the reported failure while preserving the test setup and intended behavior. Respect explicit contracts in the prompt, code, comments, and fixtures; never guess a replacement threshold or weaken an assertion arbitrarily.'
              : 'You are a senior QA engineer. Briefly explain the likely cause of the synthetic test failure and suggest concrete diagnostic steps. Do not return code.',
          },
          {
            role: 'user',
            content: canHeal
              ? `Failed test: ${test.title}\nFile: ${testFilePath}\nLine: ${test.location.line}${testContract}\n\nError:\n${errorMessage}\n\nCurrent test file:\n${redactSensitiveValues(testCode)}`
              : `Synthetic test: ${test.title}\n\nError:\n${errorMessage}`,
          },
        ],
      });

      const answer = completion.choices[0]?.message?.content?.trim();
      if (!answer) {
        const finishReason = completion.choices[0]?.finish_reason ?? 'unknown';
        throw new Error(`The AI provider returned no response (finish_reason: ${finishReason}).`);
      }

      if (!canHeal) {
        console.log('\n✨ [AI Engine] АНАЛИЗ ОШИБКИ:');
        console.log(redactSensitiveValues(answer));
        return true;
      }

      const healedCode = answer
        .replace(/^```(?:javascript|js)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const artifactDirectory = path.resolve('test-results/ai-self-healing');
      fs.mkdirSync(artifactDirectory, { recursive: true });

      const artifactPath = path.join(artifactDirectory, path.basename(testFilePath));
      fs.writeFileSync(artifactPath, healedCode, 'utf8');

      const temporaryPath = `${testFilePath}.ai-healed-${randomUUID()}.js`;
      fs.writeFileSync(temporaryPath, healedCode, 'utf8');
      const syntaxCheck = spawnSync(process.execPath, ['--check', temporaryPath], { encoding: 'utf8' });
      if (syntaxCheck.status !== 0) {
        fs.rmSync(temporaryPath, { force: true });
        throw new Error(`AI-generated code failed syntax validation: ${syntaxCheck.stderr.trim()}`);
      }

      fs.renameSync(temporaryPath, testFilePath);
      console.log(`✨ [AI Self-Healing] Updated test file: ${testFilePath}`);
      console.log(`📄 Validated candidate saved to: ${artifactPath}`);
      return true;
    } catch (error) {
      const details = [
        error.status ? `HTTP ${error.status}` : null,
        error.code ? `code ${error.code}` : null,
        error.message,
      ].filter(Boolean).join(' — ');
      console.error('[AI Self-Healing] Could not analyze or repair the test:', redactSensitiveValues(details));
      return false;
    }
  }
}

export default AiReporter;
