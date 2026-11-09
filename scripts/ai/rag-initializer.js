import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenAI } from 'openai';
import { Pool } from 'pg';
import { getOpenRouterApiKey, projectRoot } from './openrouter-config.js';

const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_EMBEDDING_MODEL = 'google/gemini-embedding-001';
const MAX_CHUNK_CHARACTERS = 5000;
const EMBEDDING_BATCH_SIZE = 32;
const DOCUMENT_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc']);

const postgres = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'qa_user',
  password: process.env.POSTGRES_PASSWORD || 'qa_password123',
  database: process.env.POSTGRES_DB || 'ecom_test_db',
});

function splitLongParagraph(paragraph) {
  const words = paragraph.split(/\s+/);
  const parts = [];
  let part = '';

  for (const word of words) {
    if (word.length > MAX_CHUNK_CHARACTERS) {
      if (part) parts.push(part);
      for (let offset = 0; offset < word.length; offset += MAX_CHUNK_CHARACTERS) {
        parts.push(word.slice(offset, offset + MAX_CHUNK_CHARACTERS));
      }
      part = '';
      continue;
    }

    const candidate = part ? `${part} ${word}` : word;
    if (candidate.length > MAX_CHUNK_CHARACTERS) {
      parts.push(part);
      part = word;
    } else {
      part = candidate;
    }
  }

  if (part) parts.push(part);
  return parts;
}

function chunkDocument(content) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_CHARACTERS) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function collectDocumentation() {
  const filePaths = [];
  const rootEntries = await readdir(projectRoot, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      filePaths.push(path.join(projectRoot, entry.name));
    }
  }

  async function visitDocs(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' && directory === path.join(projectRoot, 'docs')) return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visitDocs(fullPath);
      } else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        filePaths.push(fullPath);
      }
    }
  }

  await visitDocs(path.join(projectRoot, 'docs'));

  const documents = [];
  for (const filePath of [...new Set(filePaths)].sort()) {
    const content = await readFile(filePath, 'utf8');
    const source = path.relative(projectRoot, filePath);
    for (const [chunkIndex, chunk] of chunkDocument(content).entries()) {
      documents.push({ source, chunkIndex, content: chunk });
    }
  }

  if (documents.length === 0) {
    throw new Error('No README or text documentation files were found in the project root or docs/.');
  }
  return documents;
}

async function createEmbeddings(openrouter, model, documents) {
  const embeddings = [];

  for (let offset = 0; offset < documents.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = documents.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const response = await openrouter.embeddings.create({
      model,
      input: batch.map(document => document.content),
      dimensions: EMBEDDING_DIMENSIONS,
    });

    if (response.data.length !== batch.length) {
      throw new Error(`Embedding response count mismatch: expected ${batch.length}, received ${response.data.length}.`);
    }

    for (const item of response.data) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS
        || item.embedding.some(value => !Number.isFinite(value))) {
        throw new Error(`Embedding must contain ${EMBEDDING_DIMENSIONS} finite dimensions.`);
      }
      embeddings.push(item.embedding);
    }

    console.log(`Generated embeddings for ${Math.min(offset + batch.length, documents.length)}/${documents.length} chunks.`);
  }

  return embeddings;
}

async function initializeKnowledgeBase() {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('Set OPENROUTER_API_KEY in .env to generate knowledge-base embeddings.');
  }

  const model = process.env.OPENROUTER_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  const client = await postgres.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(${EMBEDDING_DIMENSIONS}) NOT NULL,
        UNIQUE (source, chunk_index)
      )
    `);
    console.log('pgvector extension and knowledge_base table are ready.');
  } finally {
    client.release();
  }

  const documents = await collectDocumentation();
  console.log(`Found ${documents.length} documentation chunks. Creating embeddings with ${model}...`);
  const embeddings = await createEmbeddings(openrouter, model, documents);

  const writer = await postgres.connect();
  try {
    await writer.query('BEGIN');
    await writer.query('DELETE FROM knowledge_base');

    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      await writer.query(
        `INSERT INTO knowledge_base (source, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4)`,
        [
          document.source,
          document.chunkIndex,
          document.content,
          `[${embeddings[index].join(',')}]`,
        ],
      );
    }

    await writer.query('COMMIT');
  } catch (error) {
    await writer.query('ROLLBACK');
    throw error;
  } finally {
    writer.release();
  }

  console.log(`RAG knowledge base initialized with ${documents.length} chunks (${EMBEDDING_DIMENSIONS}-dimension vectors).`);
}

try {
  await initializeKnowledgeBase();
} catch (error) {
  console.error('[RAG Initializer] Initialization failed:', error.message);
  process.exitCode = 1;
} finally {
  await postgres.end();
}
