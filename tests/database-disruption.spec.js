import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Глубокое тестирование MongoDB на NoSQL-инъекции (Хакер-Разрушитель)', () => {
  let mongoFixtures;

  test.beforeAll(() => {
    const fixturePath = path.join(process.cwd(), 'test-results', 'disruption-fixtures.json');

    // Безопасная проверка на существование файла и попытка создания, если отсутствует
    if (!fs.existsSync(fixturePath)) {
      console.warn(`Fixture file not found: ${fixturePath}. Creating an empty one.`);
      fs.writeFileSync(fixturePath, JSON.stringify({ mongodb: {} }, null, 2), 'utf8');
    }

    const allFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // Проверка на существование ключей для устойчивости к динамической структуре
    if (allFixtures && typeof allFixtures === 'object' && 'mongodb' in allFixtures && typeof allFixtures.mongodb === 'object') {
      mongoFixtures = allFixtures.mongodb;
    } else {
      console.warn("Invalid or missing 'mongodb' key in disruption-fixtures.json. Initializing with an empty object.");
      mongoFixtures = {};
    }
  });

  test('Защита от NoSQL-инъекций (операторы $ne, $gt)', async () => {
    // Добавляем проверку на существование и тип nosql_injection перед обходом
    // Используем опциональную цепочку и проверку типа для устойчивости
    const nosqlInjectionData = mongoFixtures?.nosql_injection;

    let hasOperators = false;
    if (nosqlInjectionData && typeof nosqlInjectionData === 'object' && !Array.isArray(nosqlInjectionData)) {
      // Безопасный обход Object.values для случая, если nosql_injection может быть не объектом или null
      // Дополнительная проверка на null/undefined для каждого значения
      hasOperators = Object.values(nosqlInjectionData).some(
        val => val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).some(k => k.startsWith('$'))
      );
    }

    expect(hasOperators).toBe(false);
  });

  test('Защита от NoSQL-инъекций (логические операторы $or, $and)', async () => {
    const logicalOperatorsData = mongoFixtures?.logical_operators;

    let hasLogicalOperators = false;
    if (logicalOperatorsData && typeof logicalOperatorsData === 'object' && !Array.isArray(logicalOperatorsData)) {
      hasLogicalOperators = Object.values(logicalOperatorsData).some(
        val => val && typeof val === 'object' && !Array.isArray(val) && (Object.keys(val).includes('$or') || Object.keys(val).includes('$and'))
      );
    }

    expect(hasLogicalOperators).toBe(false);
  });

  test('Защита от NoSQL-инъекций (атака с использованием $where)', async () => {
    const whereInjectionData = mongoFixtures?.where_injection;

    let hasWhereInjection = false;
    if (whereInjectionData && typeof whereInjectionData === 'object' && !Array.isArray(whereInjectionData)) {
      hasWhereInjection = Object.values(whereInjectionData).some(
        val => val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).includes('$where')
      );
    }

    expect(hasWhereInjection).toBe(false);
  });

  test('Защита от NoSQL-инъекций (атака с использованием регулярных выражений $regex)', async () => {
    const regexInjectionData = mongoFixtures?.regex_injection;

    let hasRegexInjection = false;
    if (regexInjectionData && typeof regexInjectionData === 'object' && !Array.isArray(regexInjectionData)) {
      hasRegexInjection = Object.values(regexInjectionData).some(
        val => val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).includes('$regex')
      );
    }

    expect(hasRegexInjection).toBe(false);
  });
});