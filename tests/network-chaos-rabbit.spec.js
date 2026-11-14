import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import amqp from 'amqplib';
import { ChaosManager } from '../scripts/ai/database/chaos-manager.js';

test.describe('Network Chaos: RabbitMQ latency resilience', () => {
  const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  const rabbitContainer = 'qa_rabbitmq';
  const delayMs = 1200;
  let connection;
  let channel;
  let queue;

  test.beforeAll(async () => {
    const docker = await ChaosManager.checkDockerAvailability();
    test.skip(!docker.available, `Skipping RabbitMQ network chaos test: ${docker.reason}`);
  });

  test.afterEach(async () => {
    try {
      await ChaosManager.clearNetworkChaos(rabbitContainer);
    } finally {
      if (channel) {
        try {
          if (queue) await channel.deleteQueue(queue);
        } finally {
          await channel.close();
          channel = undefined;
        }
      }
      if (connection) {
        await connection.close();
        connection = undefined;
      }
      queue = undefined;
    }
  });

  test('applies real egress latency and restores the broker network', async () => {
    console.log('🏁 Запуск теста сетевого хаоса...');
    connection = await amqp.connect(rabbitUrl);
    channel = await connection.createConfirmChannel();
    queue = `chaos_network_${randomUUID()}`;
    await channel.assertQueue(queue, { durable: false, autoDelete: true });
    channel.sendToQueue(queue, Buffer.from('ping'));
    await channel.waitForConfirms();

    const normalStart = performance.now();
    const normalStatus = await channel.checkQueue(queue);
    const normalDuration = performance.now() - normalStart;
    expect(normalStatus.messageCount).toBe(1);
    console.log(`⚡ Проверка очереди без хаоса: ${normalDuration.toFixed(0)}ms`);

    const activeQdisc = await ChaosManager.injectNetworkChaos(rabbitContainer, delayMs, 0);
    expect(activeQdisc).toContain('netem');

    const chaosStart = performance.now();
    const chaosStatus = await channel.checkQueue(queue);
    const chaosDuration = performance.now() - chaosStart;
    console.log(`🐢 Проверка очереди с задержкой ${delayMs}ms: ${chaosDuration.toFixed(0)}ms`);

    expect(chaosStatus.queue).toBe(queue);
    expect(chaosDuration - normalDuration).toBeGreaterThanOrEqual(delayMs * 0.75);
  });
});
