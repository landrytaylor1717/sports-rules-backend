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
      port: parseInt(process.env.TYPESENSE_PORT, 10),
      protocol: process.env.TYPESENSE_PROTOCOL,
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 2,
});

const ruleSources = [
  { file: '../data/rules/baseball.js', sport: 'Baseball', path: '/rules/baseballrules/' },
  { file: '../data/rules/basketball.js', sport: 'Basketball', path: '/rules/basketballrules/' },
  { file: '../data/rules/football.js', sport: 'Football', path: '/rules/footballrules/' },
  { file: '../data/rules/hockey.js', sport: 'Hockey', path: '/rules/hockeyrules/' },
  { file: '../data/rules/golf.js', sport: 'Golf', path: '/rules/golfrules/' },
];

async function indexRules() {
  try {
    const allDocs = [];

    for (const { file, sport, path: routePath } of ruleSources) {
      const ruleFile = await import(file);
      const ruleSet = Object.values(ruleFile)[0];

      ruleSet.forEach((rule) => {
        const parsed = parseRuleContent(rule, sport, `${routePath}${rule.number}`);
        allDocs.push(...parsed);
      });
    }

    const ndjson = allDocs.map((doc) => JSON.stringify(doc)).join('\n');

    const result = await client
      .collections('rules')
      .documents()
      .import(ndjson, { action: 'upsert' });

    console.log(`✅ Indexed ${allDocs.length} documents.`);
    console.log('Sample output:', result.slice(0, 5));
  } catch (err) {
    console.error('❌ Failed to index rules:', err);
  }
}

indexRules();






