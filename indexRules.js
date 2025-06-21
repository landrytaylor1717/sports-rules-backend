// backend/indexRules.js
import path from 'path';
import Typesense from 'typesense';
import { fileURLToPath } from 'url';
import { parseRuleContent } from '../utils/parseRuleContent.js'; // Adjust path if needed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Typesense.Client({
  nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
  apiKey: 'baRRa17!',
  connectionTimeoutSeconds: 2,
});

// Utility to import rule files dynamically
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
      const ruleSet = Object.values(ruleFile)[0]; // Assuming the export is like `export const baseballRules = [...]`

      ruleSet.forEach(rule => {
        const parsed = parseRuleContent(rule, sport, routePath + rule.number);
        allDocs.push(...parsed);
      });
    }

    const ndjson = allDocs.map(doc => JSON.stringify(doc)).join('\n');

    const result = await client
      .collections('rules')
      .documents()
      .import(ndjson, { action: 'upsert' });

    console.log('✅ Rules indexed. Sample output:');
    console.log(result.slice(0, 5));
  } catch (err) {
    console.error('❌ Failed to index rules:', err);
  }
}

indexRules();






