// playwright.config.js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['allure-playwright', { outputFolder: 'allure-results' }],
  ],

  use: {
    // Базовый URL, чтобы в тестах писать просто page.goto('/client')
    baseURL: 'https://rahulshettyacademy.com',

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
    reporter: [
    ['list'], // Чтобы видеть стандартный прогресс тестов в консоли
    ['./scripts/ai/ai-reporter.js'] // Наш автономный ИИ-анализатор логов
  ],

});
