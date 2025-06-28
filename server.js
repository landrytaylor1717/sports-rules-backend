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
  baseball: ['baseball', 'ballgame', 'innings', 'strikes', 'balls', 'home run', 'RBI', 'pitcher', 'batter', 'diamond', 'mound', 'bases', 'foul ball', 'strike zone'],
  basketball: ['basketball', 'hoops', 'court', 'dribble', 'slam dunk', 'three-pointer', 'foul', 'rebound', 'assist', 'field goal', 'free throw', 'technical foul'],
  hockey: ['hockey', 'ice', 'puck', 'stick', 'goal', 'penalty', 'power play', 'face-off', 'icing', 'offside'],
  golf: ['golf', 'course', 'hole', 'par', 'birdie', 'eagle', 'bogey', 'tee', 'green', 'fairway', 'stroke', 'handicap'],
  football: ['football', 'NFL', 'touchdown', 'field goal', 'quarterback', 'down', 'yard', 'endzone', 'fumble', 'interception', 'sack'],
  soccer: ['soccer', 'football', 'goal', 'penalty kick', 'offside', 'corner kick', 'yellow card', 'red card', 'goalkeeper'],
  tennis: ['tennis', 'serve', 'ace', 'deuce', 'love', 'set', 'match', 'net', 'court', 'volley']
};

// Ambiguous terms that appear in multiple sports
const ambiguousTerms = {
  'field goal': ['football', 'basketball'],
  'goal': ['hockey', 'soccer'],
  'foul': ['basketball', 'baseball'],
  'penalty': ['hockey', 'soccer', 'football'],
  'serve': ['tennis', 'volleyball'],
  'court': ['basketball', 'tennis'],
  'offside': ['hockey', 'soccer', 'football'],
  'timeout': ['basketball', 'football', 'hockey'],
  'substitution': ['soccer', 'basketball', 'hockey']
};

// Function to handle ambiguous queries
function handleAmbiguousQuery(query) {
  const lowerQuery = query.toLowerCase();
  
  for (const [term, sports] of Object.entries(ambiguousTerms)) {
    if (lowerQuery.includes(term)) {
      return {
        term: term,
        sports: sports,
        isAmbiguous: true
      };
    }
  }
  return null;
}

// Function to enhance query with sport-specific terms
function enhanceQueryWithSportsTerms(query, targetSport = null) {
  const lowerQuery = query.toLowerCase();
  let enhancedTerms = [];
  
  // If we have a target sport, prioritize its terms
  if (targetSport && sportsTerminology[targetSport]) {
    const sportTerms = sportsTerminology[targetSport];
    const mentionedTerms = sportTerms.filter(term => lowerQuery.includes(term.toLowerCase()));
    if (mentionedTerms.length > 0) {
      enhancedTerms.push(...sportTerms.slice(0, 3));
      return `${query} ${targetSport} ${enhancedTerms.join(' ')}`;
    }
  }
  
  // Check which sport terms are mentioned and add related terms
  for (const [sport, terms] of Object.entries(sportsTerminology)) {
    const mentionedTerms = terms.filter(term => lowerQuery.includes(term.toLowerCase()));
    if (mentionedTerms.length > 0) {
      // Add sport name and a few related terms to expand the search
      enhancedTerms.push(sport, ...terms.slice(0, 2));
      return `${query} ${sport} ${enhancedTerms.join(' ')}`;
    }
  }
  
  return query;
}

// Function to detect sport from query
function detectSportFromQuery(query) {
  const lowerQuery = query.toLowerCase();
  const detectedSports = [];

  for (const [sport, terms] of Object.entries(sportsTerminology)) {
    if (terms.some(term => lowerQuery.includes(term.toLowerCase()))) {
      detectedSports.push(sport);
    }
  }

  if (detectedSports.length === 1) {
    return detectedSports[0];
  }

  return null; // Ambiguous or no detection
}

// Function to create sport-specific query variations for ambiguous terms
function createSportSpecificQueries(query, sports) {
  return sports.map(sport => ({
    sport: sport,
    query: `${query} in ${sport}`,
    enhancedQuery: enhanceQueryWithSportsTerms(query, sport)
  }));
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
    let searchResults;
    let enhancedQuery = query;

    // Check if query is ambiguous and no sport filter is provided
    if (!sportFilter) {
      const ambiguousResult = handleAmbiguousQuery(query);
      
      if (ambiguousResult) {
        console.log('🔍 Ambiguous query detected:', ambiguousResult);
        
        // Try searching each sport and combine results
        const allHits = [];
        
        for (const sport of ambiguousResult.sports) {
          enhancedQuery = enhanceQueryWithSportsTerms(query, sport);
          console.log(`🔍 Searching ${sport} with query:`, enhancedQuery);
          
          const searchParameters = {
            q: enhancedQuery,
            query_by: 'content, title, combined',
            query_by_weights: '4,3,2',
            per_page: 10,
            num_typos: 2,
            filter_by: `sport:=${sport}`,
            sort_by: '_text_match:desc',
          };

          try {
            const sportResults = await client.collections('rules').documents().search(searchParameters);
            const sportHits = sportResults.hits.map(({ document, text_match }) => ({
              number: document.number,
              title: document.title,
              content: document.content,
              sport: document.sport,
              path: document.path,
              text_match: text_match,
              searchedSport: sport
            }));
            allHits.push(...sportHits);
          } catch (sportError) {
            console.log(`❌ Error searching ${sport}:`, sportError.message);
          }
        }
        
        // Sort combined results by text_match score
        allHits.sort((a, b) => b.text_match - a.text_match);
        
        console.log('✅ Ambiguous search completed - Found', allHits.length, 'results');
        return res.json({ 
          hits: allHits.slice(0, 20), // Limit to top 20 results
          isAmbiguous: true,
          searchedSports: ambiguousResult.sports,
          ambiguousTerm: ambiguousResult.term
        });
      }
    }

    // Regular search (non-ambiguous or sport filter provided)
    enhancedQuery = enhanceQueryWithSportsTerms(query, sportFilter);
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

    searchResults = await client.collections('rules').documents().search(searchParameters);
    
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
  
  if (!question) {
    console.log('❌ No question provided');
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    let detectedSport = sport || detectSportFromQuery(question);
    let searchStrategy = 'single';
    let finalAnswer = null;
    let searchedSports = [];

    // Handle ambiguous queries
    if (!detectedSport) {
      const ambiguousResult = handleAmbiguousQuery(question);
      
      if (ambiguousResult) {
        console.log('🤖 Ambiguous query detected:', ambiguousResult);
        searchStrategy = 'multiple';
        
        // Try each sport and find the best answer
        const sportQueries = createSportSpecificQueries(question, ambiguousResult.sports);
        let bestAnswer = null;
        let bestScore = 0;
        
        for (const sportQuery of sportQueries) {
          try {
            console.log(`🤖 Trying ${sportQuery.sport} with query:`, sportQuery.enhancedQuery);
            const answer = await aiHelper.answerQuestion(sportQuery.enhancedQuery, pineconeIndex, sportQuery.sport);
            
            if (answer && answer.answer && answer.answer.trim() !== '') {
              // Simple scoring based on answer length and confidence indicators
              const score = answer.answer.length + (answer.confidence || 0) * 100;
              
              if (score > bestScore) {
                bestScore = score;
                bestAnswer = {
                  ...answer,
                  sport: sportQuery.sport,
                  isAmbiguous: true,
                  searchedSports: ambiguousResult.sports
                };
              }
            }
            
            searchedSports.push(sportQuery.sport);
          } catch (sportError) {
            console.log(`❌ Error searching ${sportQuery.sport}:`, sportError.message);
          }
        }
        
        if (bestAnswer) {
          finalAnswer = bestAnswer;
          detectedSport = bestAnswer.sport;
        }
      }
    }

    // If no ambiguous result found or ambiguous search failed, try regular search
    if (!finalAnswer) {
      const enhancedQuestion = enhanceQueryWithSportsTerms(question, detectedSport);
      console.log('🤖 Enhanced question:', enhancedQuestion);
      
      console.log('🤖 Calling aiHelper.answerQuestion...');
      const answer = await aiHelper.answerQuestion(enhancedQuestion, pineconeIndex, detectedSport);
      
      if (answer && answer.answer) {
        finalAnswer = {
          ...answer,
          sport: detectedSport,
          isAmbiguous: false
        };
      }
    }
    
    console.log('🤖 Final answer:', finalAnswer);
    
    if (finalAnswer && finalAnswer.answer) {
      console.log('✅ Sending AI response');
      res.json({ 
        answer: finalAnswer.answer, 
        sport: detectedSport,
        isAmbiguous: finalAnswer.isAmbiguous || false,
        searchedSports: searchedSports.length > 0 ? searchedSports : undefined,
        searchStrategy: searchStrategy
      });
    } else {
      console.log('❌ No answer found');
      res.json({ 
        answer: "I couldn't find a specific answer to your question. Could you please specify which sport you're asking about?", 
        sport: detectedSport,
        isAmbiguous: true,
        searchedSports: searchedSports
      });
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
  const ambiguous = handleAmbiguousQuery(query);
  
  res.json({
    original: query,
    enhanced: enhanced,
    detectedSport: detected,
    ambiguousResult: ambiguous,
    sportsTerminology: sportsTerminology,
    ambiguousTerms: ambiguousTerms
  });
});

// New endpoint to test ambiguous query handling
app.post('/test-ambiguous', (req, res) => {
  const { query } = req.body;
  const ambiguousResult = handleAmbiguousQuery(query);
  
  if (ambiguousResult) {
    const sportQueries = createSportSpecificQueries(query, ambiguousResult.sports);
    res.json({
      original: query,
      isAmbiguous: true,
      ambiguousResult: ambiguousResult,
      sportSpecificQueries: sportQueries
    });
  } else {
    res.json({
      original: query,
      isAmbiguous: false,
      detectedSport: detectSportFromQuery(query),
      enhanced: enhanceQueryWithSportsTerms(query)
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
  console.log(`🏀 Test sports enhancement: http://localhost:${PORT}/test-sports-enhancement`);
  console.log(`❓ Test ambiguous queries: http://localhost:${PORT}/test-ambiguous`);
});


