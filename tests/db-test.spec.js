// tests/db-test.spec.js
import { test, expect } from '@playwright/test';
import { DbClient } from '../database/DbClient.js'; // Импортируем наш клиент базы данных

test('Проверка интеграции с PostgreSQL: Создание и чтение данных', async () => {
    // 1. Подключаемся к нашей DB в Докере
    const db = new DbClient();

    // 2. SQL-шаг: Создаем тестовую таблицу пользователей, если её еще нет в базе
    // SERIAL PRIMARY KEY означает, что ID будет увеличиваться сам автоматически (1, 2, 3...)
    await db.query(`
        CREATE TABLE IF NOT EXISTS qa_users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        );
    `);

    // Генерируем случайный имейл, чтобы тест не падал из-за уникальности (UNIQUE)
    const randomEmail = `db_beast_${Date.now()}@gmail.com`;

    // 3. SQL-шаг: Записываем нового тестировщика в базу данных
    await db.query('INSERT INTO qa_users (username, email) VALUES (\$1, \$2);', ['Duishon', randomEmail]);
    console.log(`[DB Write]: Успешно записали юзера с email: ${randomEmail}`);

    // 4. SQL-шаг: Читаем данные из базы, чтобы проверить запись (Делаем SELECT)
    const usersInDb = await db.query('SELECT * FROM qa_users WHERE email = \$1;', [randomEmail]);

    // 5. ПРОВЕРКА (Assertion): Проверяем, что база вернула нам ровно 1 строку
    expect(usersInDb.length).toBe(1);

    // Проверяем, что имя внутри базы совпадает с тем, что мы отправляли
    expect(usersInDb[0].username).toBe('Duishon');
    console.log(`[DB Read]: База вернула имя из таблицы: ${usersInDb[0].username}`);

    // 6. Закрываем пул соединений с базой, чтобы тест не зависал в конце
    await db.close();
});
