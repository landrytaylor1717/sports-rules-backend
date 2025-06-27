import { Pinecone } from '@pinecone-database/pinecone';
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

// Initialize Pinecone (updated configuration)
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const pineconeIndex = pineconeClient.index('sports-rules');

// Test endpoint to verify server is working
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Typesense Search Route
app.get('/search', async (req, res) => {
  const query = req.query.q?.trim() || '';
  const sportFilter = req.query.sport?.trim() || '';
  
  console.log('🔍 Search request - Query:', query, 'Sport filter:', sportFilter);
  
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

    console.log('✅ Search completed - Found', hits.length, 'results');
    res.json({ hits });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI Search Route using Pinecone
app.post('/search-ai', async (req, res) => {
  const { question } = req.body;
  
  console.log('🤖 AI question received:', question);
  console.log('🤖 Request body:', req.body);
  
  if (!question) {
    console.log('❌ No question provided');
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    console.log('🤖 Calling aiHelper.answerQuestion...');
    const answer = await aiHelper.answerQuestion(question, pineconeIndex);
    
    console.log('🤖 aiHelper returned:', answer);
    console.log('🤖 Type of answer:', typeof answer);
    console.log('🤖 Answer keys:', Object.keys(answer || {}));
    
    // Ensure we're returning the correct format
    if (answer && answer.answer) {
      console.log('✅ Sending AI response:', { answer: answer.answer });
      res.json({ answer: answer.answer });
    } else {
      console.log('❌ No answer in response');
      res.json({ answer: null });
    }
    
  } catch (error) {
    console.error('❌ AI Search Error:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint for debugging
app.post('/test-ai', async (req, res) => {
  console.log('🧪 Test AI endpoint called');
  res.json({ answer: "This is a test AI response to verify the frontend works" });
});

// Environment check endpoint
app.get('/env-check', (req, res) => {
  const envStatus = {
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasPinecone: !!process.env.PINECONE_API_KEY,
    hasTypesense: !!process.env.TYPESENSE_API_KEY,
    typesenseHost: process.env.TYPESENSE_HOST,
    typesensePort: process.env.TYPESENSE_PORT,
  };
  
  console.log('🔍 Environment check:', envStatus);
  res.json(envStatus);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test AI: http://localhost:${PORT}/test-ai`);
  console.log(`🔍 Env check: http://localhost:${PORT}/env-check`);
});




