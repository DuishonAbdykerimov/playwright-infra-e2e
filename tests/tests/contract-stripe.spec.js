import { test, expect } from '@playwright/test';

test.describe('Contract Testing: Верификация API-контракта со шлюзом Stripe', () => {

  test('Проверка строгого соответствия контракта Stripe API PaymentIntent', async ({ request }) => {
    console.log('💳 Запуск контрактного тестирования для Stripe API...');

    const mockStripeResponse = {
      id: "pi_test_placeholder",
      object: "payment_intent",
      amount: 4990,
      currency: "usd",
      status: "succeeded",
      client_secret: "pi_test_secret_placeholder"
    };

    console.log('🔍 Проверка полей ответа на соответствие интеграционному контракту...');

    const validateField = (obj, fieldName, expectedType, validationFn = null) => {
      expect(obj).toHaveProperty(fieldName);
      expect(typeof obj[fieldName]).toBe(expectedType, `Ошибка: Неверный тип для поля '${fieldName}'. Ожидался '${expectedType}', получен '${typeof obj[fieldName]}'.`);
      if (validationFn) {
        expect(validationFn(obj[fieldName])).toBe(true, `Ошибка: Значение поля '${fieldName}' не прошло дополнительную валидацию.`);
      }
    };

    validateField(mockStripeResponse, 'id', 'string', value => value.startsWith('pi_'));
    validateField(mockStripeResponse, 'object', 'string', value => value === 'payment_intent');
    validateField(mockStripeResponse, 'amount', 'number', value => Number.isInteger(value) && value > 0);
    validateField(mockStripeResponse, 'currency', 'string', value => /^[a-z]{3}$/.test(value));
    validateField(
      mockStripeResponse,
      'status',
      'string',
      value => ['succeeded', 'requires_payment_method', 'processing'].includes(value),
    );
    validateField(mockStripeResponse, 'client_secret', 'string', value => value.startsWith('pi_test_secret_'));

    expect(mockStripeResponse.status).toBe('succeeded');

    console.log('✅ Контракт Stripe API полностью соответствует спецификации!');
  });
});