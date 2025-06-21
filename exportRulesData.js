// backend/exportRulesData.js
import fs from 'fs';
import path from 'path';
import { baseballRules } from '../data/rules/baseball.js';
import { basketballRules } from '../data/rules/basketball.js';
import { footballRules } from '../data/rules/football.js';
import { golfRules } from '../data/rules/golf.js';
import { hockeyRules } from '../data/rules/hockey.js';
import { parseRuleContent } from '../utils/parseRuleContent.js'; // adjust if needed

const sportsData = [
  { data: baseballRules, sport: 'Baseball', path: '/rules/baseballrules' },
  { data: basketballRules, sport: 'Basketball', path: '/rules/basketballrules' },
  { data: footballRules, sport: 'Football', path: '/rules/footballrules' },
  { data: hockeyRules, sport: 'Hockey', path: '/rules/hockeyrules' },
  { data: golfRules, sport: 'Golf', path: '/rules/golfrules' },
];

let allSubrules = [];
let idCounter = 0;

for (const { data, sport, path: routePath } of sportsData) {
  data.forEach((rule) => {
    const parsed = parseRuleContent(rule, sport, `${routePath}/${rule.number}`) || [];

    parsed.forEach((subrule) => {
      if (!subrule) return; // Skip null entries

      idCounter++;

      allSubrules.push({
        id: `${sport.toLowerCase()}-${idCounter}`,
        sport,
        number: subrule.number || 'N/A',
        title: subrule.title?.trim() || '(Untitled)',
        content: subrule.content?.trim() || '',
        path: subrule.path || `${routePath}/${subrule.number}`,
        combined: subrule.combined || `${subrule.number} ${subrule.title} ${subrule.content}`,
      });
    });
  });
}


const outputDir = path.resolve('data');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'rulesData.json');
fs.writeFileSync(outputPath, JSON.stringify(allSubrules, null, 2));

console.log(`✅ Exported ${allSubrules.length} parsed rules to ${outputPath}`);


