import http from 'k6/http';
import { check } from 'k6';

const target = __ENV.LOAD_TEST_TARGET || 'http://prometheus:9090/-/healthy';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '15s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const response = http.get(target, { tags: { endpoint: 'service-health' } });
  check(response, {
    'health endpoint responds with HTTP 200': result => result.status === 200,
  });
}
