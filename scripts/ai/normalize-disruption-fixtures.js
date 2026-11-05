export function normalizeDisruptionFixtures(fixtures) {
  const username = fixtures.postgres?.username;
  const email = fixtures.postgres?.email;

  if (typeof username !== 'string' || typeof email !== 'string') {
    throw new Error('ИИ вернул фикстуру без postgres.username или postgres.email.');
  }

  if (!/^[a-z0-9._+-]+@example\.test$/.test(email)) {
    throw new Error('ИИ вернул некорректный тестовый email.');
  }

  if (fixtures.mongodb === null || typeof fixtures.mongodb !== 'object' || Array.isArray(fixtures.mongodb)) {
    throw new Error('ИИ вернул некорректную MongoDB-фикстуру.');
  }

  const normalizedUsername = username
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 64)
    .padEnd(64, 'x');

  return {
    ...fixtures,
    postgres: {
      ...fixtures.postgres,
      username: normalizedUsername,
    },
  };
}
