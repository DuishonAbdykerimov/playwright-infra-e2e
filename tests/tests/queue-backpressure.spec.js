import { test, expect } from '@playwright/test';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

test.describe('Advanced Queue Testing: Backpressure & Dead Letter Queue (DLQ)', () => {
  let connection;
  let channel;

  // Используем URL из переменных окружения или стандартный локальный порт RabbitMQ
  const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

  const runId = randomUUID();
  const DEAD_LETTER_EXCHANGE = `orders_dlx_${runId}`;
  const MAIN_QUEUE = `orders_main_queue_${runId}`;
  const DLQ_QUEUE = `orders_dead_letter_queue_${runId}`;

  test.beforeAll(async () => {
    // 1. Подключаемся к RabbitMQ брокеру
    connection = await amqp.connect(rabbitUrl);
    channel = await connection.createChannel();

    // 2. Объявляем Dead Letter Exchange (DLX) — точку обмена для "неудавшихся" сообщений
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: false });

    // 3. Создаем саму очередь DLQ, куда будут складываться отброшенные сообщения
    await channel.assertQueue(DLQ_QUEUE, { durable: false });
    // Привязываем DLQ к нашему DLX
    await channel.bindQueue(DLQ_QUEUE, DEAD_LETTER_EXCHANGE, 'rejected_orders');

    // 4. Создаем ОСНОВНУЮ очередь с жесткими лимитами для симуляции Backpressure
    await channel.assertQueue(MAIN_QUEUE, {
      durable: false,
      arguments: {
        // Если сообщение лежит в очереди больше 1.5 секунд — оно считается протухшим (TTL)
        'x-message-ttl': 1500,
        // Очередь вмещает максимум 5 сообщений. Все, что сверху — выталкивается!
        'x-max-length': 5,
        // Говорим RabbitMQ: отправляй вытолкнутые сообщения в наш созданный DLX
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        // И используй этот ключ маршрутизации
        'x-dead-letter-routing-key': 'rejected_orders'
      }
    });
  });

  test.afterAll(async () => {
    // Очищаем за собой очереди после теста, чтобы не забивать брокер
    await channel.deleteQueue(MAIN_QUEUE);
    await channel.deleteQueue(DLQ_QUEUE);
    await channel.deleteExchange(DEAD_LETTER_EXCHANGE);
    await channel.close();
    await connection.close();
  });

  test('Эффект Backpressure: переполнение очереди и автоматический редирект в DLQ', async () => {
    console.log('🚀 Запуск продвинутого теста очередей...');

    // 1. Симулируем мощную лавину заказов (Backpressure). Отправляем 8 сообщений.
    // Наша основная очередь вмещает только 5!
    const totalMessages = 8;
    console.log(`📦 Отправляем ${totalMessages} сообщений в основную очередь (лимит: 5)...`);

    for (let i = 1; i <= totalMessages; i++) {
      const payload = JSON.stringify({ orderId: i, type: 'stress_test_item' });
      channel.sendToQueue(MAIN_QUEUE, Buffer.from(payload));
    }

    // Небольшая пауза, чтобы RabbitMQ успел обработать переполнение и перекинуть сообщения
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Проверяем состояние основной очереди
    const mainQueueStatus = await channel.checkQueue(MAIN_QUEUE);
    console.log(`📊 Статус основной очереди: сообщений внутри = ${mainQueueStatus.messageCount}`);

    // В основной очереди должно остаться ровно 5 сообщений (максимальный лимит)
    expect(mainQueueStatus.messageCount).toBe(5);

    // 3. Проверяем состояние Dead Letter Queue (DLQ)
    const dlqStatus = await channel.checkQueue(DLQ_QUEUE);
    console.log(`🚨 Статус DLQ очереди: сообщений вытолкнуто = ${dlqStatus.messageCount}`);

    // Ровно 3 лишних сообщения (8 - 5 = 3) должны были автоматически улететь в DLQ!
    // Если они там — механизм защиты бэкенда от перегрузки работает безупречно.
    expect(dlqStatus.messageCount).toBe(3);

    console.log('✅ Механизм Backpressure и Dead Letter Queue успешно верифицирован!');
  });
});
