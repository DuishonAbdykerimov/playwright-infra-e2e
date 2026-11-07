import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ChaosManager {
  /**
   * Принудительно тушит Docker-контейнер сервиса
   * @param {string} serviceName - Имя сервиса из docker-compose (например, 'redis' или 'postgres')
   */
  static async killService(serviceName) {
    console.log(`⚠️ [Chaos Monkey]: Инициирую падение сервиса "${serviceName}"...`);
    await execFileAsync('docker', ['compose', 'stop', serviceName]);
    console.log(`💥 [Chaos Monkey]: Сервис "${serviceName}" успешно остановлен.`);
  }

  /**
   * Поднимает и восстанавливает упавший контейнер
   * @param {string} serviceName
   */
  static async reviveService(serviceName) {
    console.log(`🩺 [Chaos Monkey]: Восстанавливаю сервис "${serviceName}"...`);
    await execFileAsync('docker', ['compose', 'up', '--detach', '--wait', serviceName]);
    console.log(`✅ [Chaos Monkey]: Сервис "${serviceName}" снова в строю и готов к работе.`);
  }
}
