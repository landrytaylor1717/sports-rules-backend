import dotenv from 'dotenv';
import path from 'path';
import Typesense from 'typesense';
import { fileURLToPath } from 'url';
import { parseRuleContent } from '../utils/parseRuleContent.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST,
      port: parseInt(process.env.TYPESENSE_PORT || '443', 10),
      protocol: process.env.TYPESENSE_PROTOCOL || 'https',
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 5,
});

const ruleSources = [
  { file: '../data/rules/baseball.js', sport: 'Baseball', path: '/rules/baseballrules/' },
  { file: '../data/rules/basketball.js', sport: 'Basketball', path: '/rules/basketballrules/' },
  { file: '../data/rules/football.js', sport: 'Football', path: '/rules/footballrules/' },
  { file: '../data/rules/hockey.js', sport: 'Hockey', path: '/rules/hockeyrules/' },
  { file: '../data/rules/golf.js', sport: 'Golf', path: '/rules/golfrules/' },
];

const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 1500;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function safeImport(ndjson, attempt = 1) {
  try {
    return await client.collections('rules').documents().import(ndjson, { action: 'upsert' });
  } catch (err) {
    if (attempt <= MAX_RETRIES && (err.message.includes('502') || err.message.includes('503'))) {
      console.warn(`⚠️ Import failed with ${err.message}. Retrying in ${RETRY_DELAY_MS}ms (Attempt ${attempt}/${MAX_RETRIES})...`);
      await delay(RETRY_DELAY_MS);
      return safeImport(ndjson, attempt + 1);
    }
    throw err;
  }
}

async function indexRules() {
  try {
    console.log('🔧 Checking Typesense connection...');
    const collections = await client.collections().retrieve();
    console.log('✅ Existing Collections:', collections.map(c => c.name));

    const allDocs = [];

    for (const { file, sport, path: routePath } of ruleSources) {
      const filePath = path.join(__dirname, file);
      const ruleFile = await import(filePath);
      const ruleSet = Object.values(ruleFile)[0];

      if (!Array.isArray(ruleSet)) {
        console.warn(`⚠️ Skipping ${sport} - expected an array of rules.`);
        continue;
      }

      ruleSet.forEach((rule) => {
        const parsed = parseRuleContent(rule, sport, `${routePath}${rule.number}`);
        parsed.forEach(doc => {
          doc.sport = sport.toLowerCase();
          doc.combined = `${rule.title || ''} ${rule.content || ''} ${sport}`.trim();
        });
        allDocs.push(...parsed);
      });

      console.log(`✅ Loaded ${ruleSet.length} ${sport} rules.`);
    }

    if (allDocs.length === 0) {
      console.warn('⚠️ No documents to index. Check your rule files.');
      return;
    }

    console.log(`📦 Preparing to index ${allDocs.length} documents in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
      const batch = allDocs.slice(i, i + BATCH_SIZE);
      const ndjson = batch.map(doc => JSON.stringify(doc)).join('\n');

      await safeImport(ndjson);

      console.log(`✅ Indexed batch ${i / BATCH_SIZE + 1}: ${batch.length} documents.`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }

    console.log('🎉 All documents indexed successfully.');
  } catch (err) {
    console.error('❌ Failed to index rules:', err?.message || err);
  }
}

indexRules();







