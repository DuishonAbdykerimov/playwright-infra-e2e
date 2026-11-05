export function parseJsonObject(response) {
  if (typeof response !== 'string') {
    throw new TypeError('The AI response must be a string.');
  }

  const start = response.indexOf('{');
  if (start === -1) {
    throw new Error('The AI response does not contain a JSON object.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < response.length; index += 1) {
    const character = response[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(response.slice(start, index + 1));
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
          throw new Error('The AI response must contain a JSON object.');
        }
        return parsed;
      }
    }
  }

  throw new Error('The AI response contains an incomplete JSON object.');
}
