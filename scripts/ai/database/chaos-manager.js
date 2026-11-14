import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runDocker(args) {
  return execFileAsync('docker', args, { timeout: 15_000 });
}

export class ChaosManager {
  static async killService(serviceName) {
    console.log(`⚠️ [Chaos Monkey]: Инициирую падение сервиса "${serviceName}"...`);
    await runDocker(['compose', 'stop', serviceName]);
    console.log(`💥 [Chaos Monkey]: Сервис "${serviceName}" успешно УНИЧТОЖЕН.`);
  }

  static async reviveService(serviceName) {
    console.log(`🩺 [Chaos Monkey]: Восстанавливаю сервис "${serviceName}"...`);
    await runDocker(['compose', 'start', serviceName]);
    console.log(`✅ [Chaos Monkey]: Сервис "${serviceName}" снова в строю.`);
  }

  /**
   * Внедряет сетевую задержку (Latency) и потерю пакетов (Packet Loss) в контейнер
   * @param {string} containerName - Имя контейнера (например, 'qa_rabbitmq')
   * @param {number} delayMs - Задержка в миллисекундах (например, 1500)
   * @param {number} lossPercent - Процент потери пакетов (например, 20)
   */
  static async injectNetworkChaos(containerName, delayMs = 1500, lossPercent = 20) {
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new RangeError('delayMs must be a non-negative integer.');
    }
    if (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) {
      throw new RangeError('lossPercent must be between 0 and 100.');
    }

    console.log(`🌐 [Network Chaos]: Внедряю лаг сети в "${containerName}" (Задержка: ${delayMs}ms, Потеря пакетов: ${lossPercent}%)...`);
    await runDocker([
      'exec',
      '--user',
      '0',
      containerName,
      'tc',
      'qdisc',
      'replace',
      'dev',
      'eth0',
      'root',
      'netem',
      'delay',
      `${delayMs}ms`,
      'loss',
      `${lossPercent}%`,
    ]);

    const { stdout } = await runDocker(['exec', '--user', '0', containerName, 'tc', 'qdisc', 'show', 'dev', 'eth0']);
    if (!stdout.split('\n').some(line => /\bqdisc netem\b/.test(line))) {
      throw new Error(`Network chaos was not applied to ${containerName}: ${stdout.trim()}`);
    }
    console.log(`🔥 [Network Chaos]: Деградация сети активирована: ${stdout.trim()}`);
    return stdout.trim();
  }

  /**
   * Снимает все сетевые ограничения с контейнера
   * @param {string} containerName
   */
  static async clearNetworkChaos(containerName) {
    console.log(`🧹 [Network Chaos]: Очищаю сетевые правила в "${containerName}"...`);
    const { stdout } = await runDocker(['exec', '--user', '0', containerName, 'tc', 'qdisc', 'show', 'dev', 'eth0']);
    if (!stdout.split('\n').some(line => /\bqdisc netem\b/.test(line))) return false;

    await runDocker(['exec', '--user', '0', containerName, 'tc', 'qdisc', 'del', 'dev', 'eth0', 'root']);
    console.log(`✨ [Network Chaos]: Сеть восстановлена до нормальной скорости.`);
    return true;
  }
}
