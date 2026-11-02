// tests/redis-test.spec.js
import { test, expect } from '@playwright/test';
import { RedisClient } from '../database/RedisClient.js';

test('Проверка интеграции с Redis: Запись и быстрое чтение кэша сессии', async () => {
    const redisCtrl = new RedisClient();

    const fakeSessionKey = 'user_token:test-user';
    const fakeJwtToken = 'SECRET_JWT_MOCK_TOKEN_12345';
   expect(true).toBe(false);

    // 1. Имитируем бэкенд: быстро записываем токен в кэш оперативки Redis
    await redisCtrl.setKey(fakeSessionKey, fakeJwtToken);
    console.log(`[Redis Write]: Токен успешно закэширован под ключом: ${fakeSessionKey}`);

    // 2. Имитируем проверку: вычитываем токен обратно в тест
    const tokenFromCache = await redisCtrl.getKey(fakeSessionKey);
    console.log(`[Redis Read]: Redis мгновенно вернул из памяти токен: ${tokenFromCache}`);

    // 3. ПРОВЕРКА (Assertion): Убеждаемся, что данные в кэше не исказились
    expect(tokenFromCache).toBe(fakeJwtToken);
});
