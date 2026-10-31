import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const rateLimits = new Map();

async function loadEnvFile() {
  try {
    const contents = await readFile(resolve(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error('Request is too large.');
  }
  return JSON.parse(body || '{}');
}

function withinRateLimit(ip) {
  const now = Date.now();
  const previous = rateLimits.get(ip);
  if (!previous || now - previous.start > 60_000) {
    rateLimits.set(ip, { start: now, count: 1 });
    return true;
  }
  previous.count += 1;
  return previous.count <= 12;
}

async function handleChat(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(response, 503, { error: 'Add your OpenAI API key to the .env file, then restart the server to enable the Sky Guide.' });
  }
  if (!withinRateLimit(request.socket.remoteAddress || 'local')) {
    return sendJson(response, 429, { error: 'That’s a lot of questions at once. Please wait a minute and try again.' });
  }

  try {
    const body = await readJson(request);
    const question = Array.isArray(body.history) ? body.history.at(-1)?.content : '';
    if (typeof question !== 'string' || !question.trim() || question.length > 500) {
      return sendJson(response, 400, { error: 'Please enter a weather question up to 500 characters.' });
    }
    const weather = JSON.stringify(body.weather || {}).slice(0, 12_000);
    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: typeof item.content === 'string' ? item.content.slice(0, 500) : '',
        })).filter((item) => item.content)
      : [];

    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6-luna',
        instructions: `You are Sky Guide, a friendly weather explainer in a Delhi-focused weather app. Answer in plain language, usually 2–4 sentences. Use the supplied live observation and five-day forecast as your only current weather source. Explain possible meteorological reasons as general possibilities, and clearly distinguish them from measured facts. The supplied forecast can show expected changes over the next few days, but it is not historical data: never claim a change versus yesterday or an earlier forecast unless that data is provided. The weather feed does not include pressure, air quality, radar, or satellite imagery; be clear when a question needs those details. Never invent measurements or claim certainty about a forecast. Weather data: ${weather}`,
        input: history,
        max_output_tokens: 220,
      }),
    });

    const result = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error('OpenAI API request failed:', apiResponse.status, result.error?.message || 'Unknown API error');
      if (apiResponse.status === 429 && /no credits|insufficient_quota|billing|quota/i.test(result.error?.message || '')) {
        return sendJson(response, 429, { error: 'The OpenAI API account has no credits remaining. Add API credits in your OpenAI Platform billing settings, then try again.' });
      }
      if (apiResponse.status === 429) {
        return sendJson(response, 429, { error: 'The OpenAI API rate limit was reached. Wait a moment and try again.' });
      }
      return sendJson(response, 502, { error: 'The Sky Guide could not reach its AI service. Check your API key and account access, then try again.' });
    }
    return sendJson(response, 200, { answer: result.output_text || 'I couldn’t form an answer just now. Please try asking another way.' });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(response, 400, { error: 'Could not read that request. Please try again.' });
    if (error.message === 'Request is too large.') return sendJson(response, 413, { error: error.message });
    console.error('Sky Guide error:', error.message);
    return sendJson(response, 500, { error: 'Something went wrong while preparing the answer. Please try again.' });
  }
}

await loadEnvFile();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'POST' && url.pathname === '/api/chat') return handleChat(request, response);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    return response.end('Method not allowed');
  }

  const publicFiles = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css' };
  const fileName = publicFiles[url.pathname];
  if (!fileName) {
    response.writeHead(404);
    return response.end('Not found');
  }
  const filePath = resolve(root, fileName);
  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    return response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404);
    return response.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Weatherly is running at http://localhost:${port}`));
