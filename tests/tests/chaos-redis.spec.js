import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { RedisClient } from '../../database/RedisClient.js';
import { ChaosManager } from '../../scripts/ai/database/chaos-manager.js';

test.describe('Chaos Engineering: Тестирование устойчивости к отказам инфраструктуры', () => {
  test.afterEach(async () => {
    await ChaosManager.reviveService('redis_cache');
  });

  test('Устойчивость к кратковременному падению кэша Redis', async () => {
    const unavailableRedis = new RedisClient({
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: false,
      },
    });
    await ChaosManager.killService('redis_cache');

    await expect(
      unavailableRedis.setKey('chaos_session', 'hacker_vibe'),
    ).rejects.toThrow();

    await ChaosManager.reviveService('redis_cache');

    const redis = new RedisClient();
    const key = `chaos_session:${randomUUID()}`;
    await redis.setKey(key, 'hacker_vibe');
    await expect(redis.getKey(key)).resolves.toBe('hacker_vibe');
  });
});
