import { test, expect } from '@playwright/test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import path from 'node:path';

test.describe('OpenAPI Contract Testing: Валидация по живой спецификации Swagger', () => {
  let validateSchema;
  let openApiSpec;

  test.beforeAll(() => {
    // 1. Загружаем живую OpenAPI (Swagger) спецификацию
    // Путь к файлу спецификации должен быть динамически определяемым
    // или частью конфигурации, но для примера оставляем как есть.
    // Убедимся, что файл stripe-openapi.json находится в директории contracts
    // относительно корня проекта.
    const swaggerPath = path.join(process.cwd(), 'contracts', 'stripe-openapi.json');

    // Проверяем существование файла, чтобы избежать ошибок при его отсутствии
    if (!fs.existsSync(swaggerPath)) {
      throw new Error(`Файл спецификации OpenAPI не найден по пути: ${swaggerPath}`);
    }

    try {
      openApiSpec = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
    } catch (error) {
      throw new Error(`Ошибка при чтении или парсинге файла спецификации OpenAPI: ${error.message}`);
    }

    // Извлекаем схему PaymentIntent из Swagger
    // Убедимся, что путь к схеме существует в спецификации
    if (!openApiSpec.components || !openApiSpec.components.schemas || !openApiSpec.components.schemas.PaymentIntent) {
      throw new Error('Схема "PaymentIntent" не найдена в OpenAPI спецификации. Проверьте путь: components.schemas.PaymentIntent');
    }
    const paymentSchema = openApiSpec.components.schemas.PaymentIntent;

    // 2. Компилируем строгий валидатор контрактов
    const ajv = new Ajv({ allErrors: true });
    // Добавляем поддержку форматов, таких как date-time, email и т.д.
    addFormats(ajv);
    try {
      validateSchema = ajv.compile(paymentSchema);
    } catch (error) {
      throw new Error(`Ошибка при компиляции схемы PaymentIntent: ${error.message}`);
    }
  });

  test('Проверка соответствия ответа API контракту Swagger 3.0', async () => {
    console.log('📜 Загружена спецификация OpenAPI 3.0. Валидирую контракт...');

    // Имитируем ответ от микросервиса.
    // В реальном сценарии, это будет фактический ответ от API.
    const incomingApiResponse = {
      id: "pi_3Mtw76LkdIwHu7ix28aZIn7b",
      object: "payment_intent",
      amount: 4990,
      currency: "usd",
      status: "succeeded"
    };

    // Проверяем ответ по схеме Swagger
    const isValid = validateSchema(incomingApiResponse);

    if (!isValid) {
      const errorDetails = JSON.stringify(validateSchema.errors, null, 2);
      console.error('❌ НАРУШЕНИЕ КОНТРАКТА OPENAPI:\n', errorDetails);
    }

    // Если контракт нарушен, тест упадет.
    // Ожидание должно быть максимально информативным.
    expect(isValid, `Ответ API не соответствует схеме Swagger.\nДетали ошибок: ${JSON.stringify(validateSchema.errors, null, 2)}`).toBe(true);

    console.log('✅ Контракт OpenAPI 3.0 полностью соблюден!');
  });
});