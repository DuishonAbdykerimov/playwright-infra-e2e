import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: path.join(projectRoot, '.env') });

export function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!apiKey.startsWith('sk-or-v1-') || apiKey.includes('...') || apiKey !== apiKey.trim()) {
    throw new Error(
      'OPENROUTER_API_KEY is truncated or malformed. Replace it with the complete key in .env or GitHub Actions secrets.',
    );
  }

  return apiKey;
}

export { projectRoot };
