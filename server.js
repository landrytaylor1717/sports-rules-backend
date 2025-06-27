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

// Sports terminology mapping for query enhancement
const sportsTerminology = {
  baseball: ['baseball', 'ballgame', 'innings', 'strikes', 'balls', 'home run', 'RBI', 'pitcher', 'batter', 'diamond', 'mound', 'bases'],
  basketball: ['basketball', 'hoops', 'court', 'dribble', 'slam dunk', 'three-pointer', 'foul', 'rebound', 'assist'],
  hockey: ['hockey', 'ice', 'puck', 'stick', 'goal', 'penalty', 'power play', 'face-off'],
  golf: ['golf', 'course', 'hole', 'par', 'birdie', 'eagle', 'bogey', 'tee', 'green', 'fairway'],
  football: ['football', 'NFL', 'touchdown', 'field goal', 'quarterback', 'down', 'yard', 'endzone']
};

// Function to enhance query with sport-specific terms
function enhanceQueryWithSportsTerms(query) {
  const lowerQuery = query.toLowerCase();
  let enhancedTerms = [];
  
  // Check which sport terms are mentioned and add related terms
  for (const [sport, terms] of Object.entries(sportsTerminology)) {
    const mentionedTerms = terms.filter(term => lowerQuery.includes(term.toLowerCase()));
    if (mentionedTerms.length > 0) {
      // Add a few related terms to expand the search
      enhancedTerms.push(...terms.slice(0, 3));
      break; // Focus on the first sport detected
    }
  }
  
  return enhancedTerms.length > 0 ? `${query} ${enhancedTerms.join(' ')}` : query;
}

// Function to detect sport from query
function detectSportFromQuery(query) {
  const lowerQuery = query.toLowerCase();
  
  for (const [sport, terms] of Object.entries(sportsTerminology)) {
    if (terms.some(term => lowerQuery.includes(term.toLowerCase()))) {
      return sport === 'american_football' ? 'football' : sport;
    }
  }
  
  return null;
}

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
    // Enhance query with sports-specific terms
    const enhancedQuery = enhanceQueryWithSportsTerms(query);
    console.log('🔍 Enhanced query:', enhancedQuery);

    const searchParameters = {
      q: enhancedQuery,
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

// AI Search Route using Pinecone with enhanced sports handling
app.post('/search-ai', async (req, res) => {
  const { question, sport } = req.body;
  
  console.log('🤖 AI question received:', question);
  console.log('🤖 Sport parameter:', sport);
  console.log('🤖 Request body:', req.body);
  
  if (!question) {
    console.log('❌ No question provided');
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    // Detect sport from query if not provided
    const detectedSport = sport || detectSportFromQuery(question);
    console.log('🤖 Detected/provided sport:', detectedSport);
    
    // Enhance the question with sport-specific terminology
    const enhancedQuestion = enhanceQueryWithSportsTerms(question);
    console.log('🤖 Enhanced question:', enhancedQuestion);
    
    console.log('🤖 Calling aiHelper.answerQuestion...');
    const answer = await aiHelper.answerQuestion(enhancedQuestion, pineconeIndex, detectedSport);
    
    console.log('🤖 aiHelper returned:', answer);
    console.log('🤖 Type of answer:', typeof answer);
    console.log('🤖 Answer keys:', Object.keys(answer || {}));
    
    // Ensure we're returning the correct format
    if (answer && answer.answer) {
      console.log('✅ Sending AI response:', { answer: answer.answer });
      res.json({ answer: answer.answer, sport: detectedSport });
    } else {
      console.log('❌ No answer in response');
      res.json({ answer: null, sport: detectedSport });
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

// Debug endpoint to test sports term enhancement
app.post('/test-sports-enhancement', (req, res) => {
  const { query } = req.body;
  const enhanced = enhanceQueryWithSportsTerms(query);
  const detected = detectSportFromQuery(query);
  
  res.json({
    original: query,
    enhanced: enhanced,
    detectedSport: detected,
    sportsTerminology: sportsTerminology
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test AI: http://localhost:${PORT}/test-ai`);
  console.log(`🔍 Env check: http://localhost:${PORT}/env-check`);
  console.log(`🏀 Test sports enhancement: http://localhost:${PORT}/test-sports-enhancement`);
});



