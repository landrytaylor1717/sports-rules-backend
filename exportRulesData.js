// backend/exportRulesData.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRuleContent } from '../utils/parseRuleContent.js';

import { baseballRules } from '../data/rules/baseball.js';
import { basketballRules } from '../data/rules/basketball.js';
import { footballRules } from '../data/rules/football.js';
import { golfRules } from '../data/rules/golf.js';
import { hockeyRules } from '../data/rules/hockey.js';

// Resolve __dirname for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sportsData = [
  { rules: baseballRules, sport: 'Baseball', route: '/rules/baseballrules' },
  { rules: basketballRules, sport: 'Basketball', route: '/rules/basketballrules' },
  { rules: footballRules, sport: 'Football', route: '/rules/footballrules' },
  { rules: hockeyRules, sport: 'Hockey', route: '/rules/hockeyrules' },
  { rules: golfRules, sport: 'Golf', route: '/rules/golfrules' },
];

const allParsedRules = [];
let idCounter = 0;

for (const { rules, sport, route } of sportsData) {
  for (const rule of rules) {
    const parsedSubrules = parseRuleContent(rule, sport, `${route}/${rule.number}`) || [];

    for (const subrule of parsedSubrules) {
      if (!subrule) continue;

      idCounter++;

      allParsedRules.push({
        id: `${sport.toLowerCase()}-${idCounter}`,
        sport,
        number: subrule.number || 'N/A',
        title: subrule.title?.trim() || '(Untitled)',
        content: subrule.content?.trim() || '',
        path: subrule.path || `${route}/${subrule.number}`,
        combined: subrule.combined || `${subrule.number} ${subrule.title} ${subrule.content}`,
      });
    }
  }
}

// Output to project root /data directory
const outputDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'rulesData.json');
fs.writeFileSync(outputPath, JSON.stringify(allParsedRules, null, 2));

console.log(`✅ Exported ${allParsedRules.length} parsed rules to ${outputPath}`);


