import AiReporter from './ai-reporter.js';

const reporter = new AiReporter();
const analyzed = await reporter.onTestEnd(
  {
    title: 'Synthetic AI reporter smoke test',
    location: {
      file: 'scripts/ai/ai-smoke-test.js',
      line: 1,
    },
  },
  {
    status: 'failed',
    errors: [
      {
        message: 'Synthetic failure: expected "ready" but received "not ready".',
      },
    ],
  },
);

if (!analyzed) {
  process.exitCode = 1;
}
