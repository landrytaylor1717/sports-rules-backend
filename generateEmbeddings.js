import { baseballRules } from '../data/rules/baseball.js';
import { basketballRules } from '../data/rules/basketball.js';
import { footballRules } from '../data/rules/football.js';
import { golfRules } from '../data/rules/golf.js';
import { hockeyRules } from '../data/rules/hockey.js';

import Pinecone from '@pinecone-database/pinecone';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});

const index = pineconeClient.index('sports-rules');

const allRules = [
  { sport: 'Baseball', rules: baseballRules },
  { sport: 'Basketball', rules: basketballRules },
  { sport: 'Football', rules: footballRules },
  { sport: 'Golf', rules: golfRules },
  { sport: 'Hockey', rules: hockeyRules },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmbeddings() {
  for (const { sport, rules } of allRules) {
    for (const rule of rules) {
      try {
        const text = `${rule.title}. ${rule.content}`;
        const embedding = await getEmbedding(text);

        await index.upsert([
          {
            id: `${sport}-${rule.number}`,
            values: embedding,
            metadata: {
              sport,
              number: rule.number,
              title: rule.title,
              content: rule.content,
            },
          },
        ]);

        console.log(`✅ Embedded: ${sport} Rule ${rule.number}`);
      } catch (error) {
        console.error(`❌ Failed to embed: ${sport} Rule ${rule.number}`, error?.message || error);
      }

      await sleep(2000); // 2-second delay to reduce rate limit risk
    }
  }

  console.log('✅ All embeddings generated and upserted.');
}

async function getEmbedding(text, retries = 3) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: text,
        model: 'text-embedding-ada-002',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    return response.data.data[0].embedding;
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      console.warn('⚠️ Rate limit hit. Retrying in 5 seconds...');
      await sleep(5000);
      return getEmbedding(text, retries - 1);
    } else {
      throw error;
    }
  }
}

generateEmbeddings().catch(console.error);
