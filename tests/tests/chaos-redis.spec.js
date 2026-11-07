import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { RedisClient } from '../../database/RedisClient.js';
import { ChaosManager } from '../../scripts/ai/database/chaos-manager.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

test.describe('Chaos Engineering: Тестирование устойчивости к отказам инфраструктуры', () => {
  // Проверяем доступность Docker перед запуском тестов
  test.beforeAll(async () => {
    try {
      await execAsync('docker ps');
    } catch (error) {
      console.error('Docker не запущен или недоступен. Пропускаем тесты Chaos Engineering.', error);
      test.skip(); // Пропускаем все тесты в этом describe, если Docker недоступен
    }
  });

  test.afterEach(async () => {
    // Безопасное восстановление сервиса: проверяем, что ChaosManager существует и метод reviveService доступен
    if (ChaosManager && typeof ChaosManager.reviveService === 'function') {
      try {
        await ChaosManager.reviveService('redis_cache');
      } catch (error) {
        console.warn('Не удалось восстановить сервис redis_cache после теста. Возможно, он уже был в рабочем состоянии или возникла другая ошибка.', error);
      }
    } else {
      console.warn('ChaosManager или reviveService недоступны. Пропуск восстановления сервиса.');
    }
  });

  test('Устойчивость к кратковременному падению кэша Redis', async ({ page }) => {
    const unavailableRedis = new RedisClient({
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: false,
      },
    });

    // Безопасное убийство сервиса: проверяем, что ChaosManager существует и метод killService доступен
    if (ChaosManager && typeof ChaosManager.killService === 'function') {
      try {
        await ChaosManager.killService('redis_cache');
      } catch (error) {
        // Если сервис уже остановлен или не существует, killService может выбросить ошибку.
        // Мы ожидаем, что Redis будет недоступен, поэтому эта ошибка может быть допустима.
        console.warn('Не удалось остановить сервис redis_cache. Возможно, он уже был остановлен или возникла другая ошибка.', error);
      }
    } else {
      console.warn('ChaosManager или killService недоступны. Пропуск попытки остановить сервис.');
    }

    // Проверка, что Redis действительно недоступен
    // Используем toThrow() без аргументов или с RegExp, чтобы быть устойчивыми к различным сообщениям об ошибках
    // от разных версий Redis или клиентских библиотек, но убеждаемся, что это именно ошибка подключения.
    await expect(
      unavailableRedis.setKey('chaos_session', 'hacker_vibe'),
    ).rejects.toThrow(/connect|offline|timeout/i); // Ожидаем ошибку, связанную с подключением, офлайн или таймаутом

    // Безопасное восстановление сервиса: повторно используем afterEach логику
    if (ChaosManager && typeof ChaosManager.reviveService === 'function') {
      try {
        await ChaosManager.reviveService('redis_cache');
      } catch (error) {
        console.error('Критическая ошибка: не удалось восстановить сервис redis_cache после попытки убить его.', error);
        // Если не удалось восстановить, последующие проверки могут быть ложноотрицательными.
        // Можно добавить test.fail() или бросить ошибку, чтобы остановить тест.
        throw new Error('Не удалось восстановить Redis. Дальнейшие проверки могут быть ненадежными.');
      }
    } else {
      throw new Error('ChaosManager или reviveService недоступны для восстановления сервиса.');
    }

    // Добавляем задержку, чтобы дать Redis время на полную инициализацию после восстановления
    await page.waitForTimeout(2000); // 2 секунды задержки, можно настроить

    const redis = new RedisClient();
    const key = `chaos_session:${randomUUID()}`;

    // Пытаемся установить ключ. Если Redis все еще недоступен, эта операция тоже должна быть обработана.
    try {
      await redis.setKey(key, 'hacker_vibe');
      // Если setKey успешен, проверяем getKey
      const retrievedValue = await redis.getKey(key);
      // Добавляем проверку, что retrievedValue не null/undefined, прежде чем ассертить его
      expect(retrievedValue).not.toBeNull();
      expect(retrievedValue).not.toBeUndefined();
      expect(retrievedValue).toBe('hacker_vibe');
    } catch (error) {
      // Если setKey/getKey провалились даже после восстановления, это серьезная проблема.
      console.error('RedisClient не смог установить/получить ключ после восстановления сервиса.', error);
      throw new Error('Redis не функционирует корректно после восстановления.');
    }
  });
});