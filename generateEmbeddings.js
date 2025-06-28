import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import dotenv from 'dotenv';
import { baseballRules } from '../data/rules/baseball.js';
import { basketballRules } from '../data/rules/basketball.js';
import { footballRules } from '../data/rules/football.js';
import { golfRules } from '../data/rules/golf.js';
import { hockeyRules } from '../data/rules/hockey.js';
import { parseRuleContent } from '../utils/parseRuleContent.js'; // Adjust to your actual path

dotenv.config();

// Initialize Pinecone client
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pc.index('sports-rules');

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
        const docs = parseRuleContent(rule, sport, `/rules/${sport.toLowerCase()}rules/${rule.number}`);

        if (!docs || docs.length === 0) {
          console.warn(`⚠️ No parsed content for ${sport} Rule ${rule.number}`);
          continue;
        }

        for (const doc of docs) {
          const embedding = await getEmbedding(doc.combined);

          await index.upsert([
            {
              id: doc.id,
              values: embedding,
              metadata: {
                sport: doc.sport,
                number: doc.number,
                title: doc.title,
                content: doc.content,
                path: doc.path,
              },
            },
          ]);

          console.log(`✅ Embedded: ${doc.id}`);
          await sleep(2000); // Maintain safety for OpenAI rate limits
        }
      } catch (error) {
        console.error(`❌ Failed to embed or upsert for ${sport} Rule ${rule.number}`, error?.message || error);
      }
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
        model: 'text-embedding-3-small', // Adjust model if needed
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
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
