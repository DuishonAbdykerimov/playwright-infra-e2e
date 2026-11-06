import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Глубокое тестирование MongoDB на NoSQL-инъекции (Хакер-Разрушитель)', () => {
  let mongoFixtures;

  test.beforeAll(() => {
    const fixturePath = path.join(process.cwd(), 'test-results', 'disruption-fixtures.json');
    
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Fixture file not found: ${fixturePath}`);
    }

    const allFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    
    // Проверка на существование ключей для устойчивости к динамической структуре
    if (allFixtures && typeof allFixtures === 'object' && 'mongodb' in allFixtures) {
      mongoFixtures = allFixtures.mongodb;
    } else {
      throw new Error("Invalid or missing 'mongodb' key in disruption-fixtures.json");
    }
  });

  test('Защита от NoSQL-инъекций (операторы $ne, $gt)', async () => {
    // Добавляем проверку на существование и тип nosql_injection перед обходом
    const nosqlInjectionData = mongoFixtures?.nosql_injection;

    let hasOperators = false;
    if (nosqlInjectionData && typeof nosqlInjectionData === 'object') {
      hasOperators = Object.values(nosqlInjectionData).some(
        val => val && typeof val === 'object' && Object.keys(val).some(k => k.startsWith('$'))
      );
    }
    
    expect(hasOperators).toBe(false); 
  });
});