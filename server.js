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

// Simplified sports terminology mapping - focus on most common terms
const sportsTerminology = {
  baseball: ['baseball', 'inning', 'strike', 'ball', 'home run', 'pitcher', 'batter', 'base', 'foul', 'diamond'],
  basketball: ['basketball', 'court', 'dribble', 'dunk', 'three-pointer', 'foul', 'rebound', 'assist', 'free throw'],
  hockey: ['hockey', 'puck', 'stick', 'goal', 'penalty', 'power play', 'face-off', 'icing', 'offside'],
  golf: ['golf', 'hole', 'par', 'birdie', 'eagle', 'bogey', 'tee', 'green', 'fairway', 'stroke'],
  football: ['football', 'touchdown', 'field goal', 'quarterback', 'down', 'yard', 'endzone', 'fumble', 'interception'],
  soccer: ['soccer', 'football', 'goal', 'penalty kick', 'offside', 'corner kick', 'yellow card', 'red card'],
  tennis: ['tennis', 'serve', 'ace', 'deuce', 'love', 'set', 'match', 'net', 'volley']
};

// Simplified ambiguous terms
const ambiguousTerms = {
  'field goal': ['football', 'basketball'],
  'goal': ['hockey', 'soccer'],
  'foul': ['basketball', 'baseball'],
  'penalty': ['hockey', 'soccer', 'football'],
  'offside': ['hockey', 'soccer', 'football'],
  'timeout': ['basketball', 'football', 'hockey']
};

// Simplified sport detection
function detectSportFromQuery(query) {
  const lowerQuery = query.toLowerCase();
  
  // Direct sport name detection first
  for (const sport of Object.keys(sportsTerminology)) {
    if (lowerQuery.includes(sport)) {
      console.log('🏀 Direct sport detection:', sport);
      return sport;
    }
  }
  
  // Term-based detection
  const detectedSports = [];
  for (const [sport, terms] of Object.entries(sportsTerminology)) {
    if (terms.some(term => lowerQuery.includes(term.toLowerCase()))) {
      detectedSports.push(sport);
    }
  }

  if (detectedSports.length === 1) {
    console.log('🏀 Term-based sport detection:', detectedSports[0]);
    return detectedSports[0];
  }

  console.log('🏀 No clear sport detected, found:', detectedSports);
  return null;
}

// Simplified query enhancement
function enhanceQueryWithSportsTerms(query, targetSport = null) {
  // Don't over-complicate - just add sport name if detected
  if (targetSport) {
    return `${query} ${targetSport}`;
  }
  return query;
}

// Test endpoint to verify server is working
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Typesense Search Route (simplified)
app.get('/search', async (req, res) => {
  const query = req.query.q?.trim() || '';
  const sportFilter = req.query.sport?.trim().toLowerCase() || '';

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
      highlight_fields: 'title,content',
      highlight_full_fields: 'title,content',
      snippet_threshold: 30
    };

    const searchResults = await client.collections('rules').documents().search(searchParameters);

    const hits = searchResults.hits.map(({ document, highlights }) => ({
      number: document.number,
      title: document.title,
      content: document.content,
      sport: document.sport,
      path: document.path,
      highlights
    }));

    const facets = searchResults.facet_counts || [];

    console.log('✅ Search completed - Found', hits.length, 'results');
    res.json({ hits, facets });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Simplified AI Search Route
app.post('/search-ai', async (req, res) => {
  const { question, sport } = req.body;
  
  console.log('🤖 AI question received:', question);
  console.log('🤖 Sport parameter:', sport);
  
  if (!question || question.trim() === '') {
    console.log('❌ No question provided');
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    // Detect sport if not provided
    let detectedSport = sport || detectSportFromQuery(question);
    console.log('🤖 Detected/provided sport:', detectedSport);

    // Try the AI helper directly first
    console.log('🤖 Calling aiHelper.answerQuestion with original question...');
    let answer = await aiHelper.answerQuestion(question, pineconeIndex, detectedSport);
    
    // If no good answer and we have a detected sport, try without sport filter as fallback
    if ((!answer || !answer.answer || answer.answer.includes("couldn't find")) && detectedSport) {
      console.log('🔄 Trying fallback without sport filter...');
      answer = await aiHelper.answerQuestion(question, pineconeIndex, null);
    }
    
    console.log('🤖 Final answer result:', answer);
    
    if (answer && answer.answer && answer.answer.trim() !== '') {
      console.log('✅ Sending AI response');
      res.json({ 
        answer: answer.answer, 
        sport: detectedSport,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('❌ No valid answer found');
      res.json({ 
        answer: "I couldn't find relevant information in the rulebook to answer your question. Please try rephrasing or be more specific about the sport and rule you're asking about.", 
        sport: detectedSport
      });
    }
    
  } catch (error) {
    console.error('❌ AI Search Error:', error.message);
    console.error('❌ Full error stack:', error.stack);
    res.status(500).json({ 
      error: 'An error occurred while processing your question',
      details: error.message 
    });
  }
});

// Test endpoint for debugging
app.post('/test-ai', async (req, res) => {
  console.log('🧪 Test AI endpoint called');
  try {
    // Test with a simple question
    const testQuestion = "what is a field goal";
    console.log('🧪 Testing with question:', testQuestion);
    
    const result = await aiHelper.answerQuestion(testQuestion, pineconeIndex, 'football');
    console.log('🧪 Test result:', result);
    
    res.json({ 
      testQuestion: testQuestion,
      result: result,
      status: "Test completed successfully" 
    });
  } catch (error) {
    console.error('🧪 Test error:', error);
    res.status(500).json({ 
      error: error.message,
      status: "Test failed" 
    });
  }
});

// Environment check endpoint
app.get('/env-check', (req, res) => {
  const envStatus = {
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasPinecone: !!process.env.PINECONE_API_KEY,
    hasTypesense: !!process.env.TYPESENSE_API_KEY,
    typesenseHost: process.env.TYPESENSE_HOST,
    typesensePort: process.env.TYPESENSE_PORT,
    openaiKeyLength: process.env.OPENAI_API_KEY?.length || 0,
    pineconeKeyLength: process.env.PINECONE_API_KEY?.length || 0,
  };
  
  console.log('🔍 Environment check:', envStatus);
  res.json(envStatus);
});

// Simplified debug endpoint
app.post('/test-sports-enhancement', (req, res) => {
  const { query } = req.body;
  const detected = detectSportFromQuery(query);
  const enhanced = enhanceQueryWithSportsTerms(query, detected);
  
  res.json({
    original: query,
    detectedSport: detected,
    enhanced: enhanced,
    availableSports: Object.keys(sportsTerminology)
  });
});

// Pinecone connection test
app.get('/test-pinecone', async (req, res) => {
  try {
    console.log('🧪 Testing Pinecone connection...');
    
    // Test the index stats
    const stats = await pineconeIndex.describeIndexStats();
    console.log('🧪 Pinecone stats:', stats);
    
    // Test a simple query
    const testVector = new Array(1536).fill(0.1); // OpenAI embedding dimension
    const testQuery = await pineconeIndex.query({
      vector: testVector,
      topK: 1,
      includeMetadata: true
    });
    
    console.log('🧪 Test query result:', testQuery);
    
    res.json({
      status: 'Pinecone connection successful',
      stats: stats,
      testQueryResults: testQuery.matches?.length || 0
    });
  } catch (error) {
    console.error('🧪 Pinecone test error:', error);
    res.status(500).json({
      status: 'Pinecone connection failed',
      error: error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test AI: http://localhost:${PORT}/test-ai`);
  console.log(`🔍 Env check: http://localhost:${PORT}/env-check`);
  console.log(`🧪 Test Pinecone: http://localhost:${PORT}/test-pinecone`);
  console.log(`🏀 Debug sports: http://localhost:${PORT}/test-sports-enhancement`);
});

