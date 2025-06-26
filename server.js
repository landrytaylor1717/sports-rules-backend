import * as pinecone from '@pinecone-database/pinecone';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import Typesense from 'typesense';
import aiHelper from './aiHelper.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Typesense
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

// Initialize Pinecone with updated controllerHostUrl
const pineconeClient = new pinecone.Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  controllerHostUrl: `https://controller.${process.env.PINECONE_ENVIRONMENT}.pinecone.io`,
});

const pineconeIndex = pineconeClient.Index('sports-rules');

// Typesense Search Route
app.get('/search', async (req, res) => {
  const query = req.query.q?.trim() || '';
  const sportFilter = req.query.sport?.trim() || '';

  if (!query) {
    return res.status(400).json({ error: 'Query param `q` is required' });
  }

  try {
    const searchParameters = {
      q: query,
      query_by: 'content, title, combined',
      query_by_weights: '4,3,2',
      per_page: 20,
      num_typos: 2,
      filter_by: sportFilter ? `sport:=${sportFilter}` : undefined,
      sort_by: '_text_match:desc',
    };

    const searchResults = await client.collections('rules').documents().search(searchParameters);

    const hits = searchResults.hits.map(({ document }) => ({
      number: document.number,
      title: document.title,
      content: document.content,
      sport: document.sport,
      path: document.path,
    }));

    res.json({ hits });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI Search Route using Pinecone
app.post('/search-ai', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const answer = await aiHelper.answerQuestion(question, pineconeIndex);
    res.json(answer);
  } catch (error) {
    console.error('AI Search Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});





