import axios from 'axios';

export default {
  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      console.log('🤖 Step 1: Getting embedding...');
      const embedding = await this.getEmbedding(question);
      console.log('🤖 Step 2: Got embedding of length:', embedding.length);

      // Always query all sports first for better context
      const queryParams = {
        vector: embedding,
        topK: 15, // Increased for better sport coverage
        includeMetadata: true,
      };

      console.log('🤖 Step 3: Querying Pinecone (all sports)...');
      const queryResponse = await pineconeIndex.query(queryParams);
      console.log('🤖 Step 4: Pinecone returned', queryResponse.matches?.length || 0, 'matches');
      
      if (queryResponse.matches?.length > 0) {
        console.log('🔍 DEBUG: Available sports in results:');
        const sportsFound = [...new Set(queryResponse.matches.map(m => m.metadata?.sport).filter(Boolean))];
        console.log('  - Sports found:', sportsFound);
        
        queryResponse.matches.slice(0, 5).forEach((match, i) => {
          console.log(`  - Match ${i + 1}: ${match.metadata?.sport || 'Unknown'} (Score: ${match.score?.toFixed(3)})`);
        });
      }

      const scoredMatches = queryResponse.matches || [];
      const topScore = scoredMatches[0]?.score || 0;
      console.log(`🎯 Top result score: ${topScore.toFixed(3)}`);

      // Enhanced processing with better contextual understanding
      const topChunks = this.processAndRankResults(scoredMatches, question);
      
      console.log('🔍 Top chunks length:', topChunks.length);

      let prompt;
      const MIN_CONTENT_LENGTH = 15;

      if (scoredMatches.length > 0 && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content with enhanced contextual reasoning...');
        
        // Enhanced prompt with better sport identification logic
        prompt = `You are an expert sports rulebook assistant with access to official rules from multiple sports. Your job is to provide the most accurate and contextually appropriate answer.

CRITICAL ANALYSIS PROCESS:
1. **IDENTIFY THE MOST LIKELY SPORT**: Analyze the question terminology and scenario to determine which sport it most likely refers to:
   - "Ball into water" → Typically GOLF (water hazards are common)
   - "Ball over fence" → Typically BASEBALL (home runs)
   - "Out of bounds" → Could be multiple sports, analyze other context clues
   - "Offside" → Typically FOOTBALL/SOCCER
   - "Traveling" → Typically BASKETBALL

2. **PRIORITIZE RELEVANT CONTENT**: Focus primarily on rules from the most contextually appropriate sport, even if other sports have loosely related rules.

3. **PROVIDE COMPREHENSIVE ANSWERS**: Give detailed, complete answers using the most relevant sport's official rules.

4. **ACKNOWLEDGE WHEN UNCERTAIN**: If genuinely ambiguous, mention the uncertainty but still lead with the most probable interpretation.

QUESTION: "${question}"

AVAILABLE RULEBOOK CONTENT (ranked by contextual relevance):
${topChunks}

INSTRUCTIONS FOR YOUR RESPONSE:
- Start by identifying which sport this question most likely refers to
- Provide a comprehensive answer using that sport's official rules
- Structure your response clearly with headings if appropriate
- If the question could apply to multiple sports, briefly acknowledge this but focus on the most likely one
- Base your answer on the official rulebook content provided above

Answer:`;

      } else {
        console.log('⚠️ No relevant content found...');
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I searched the sports rulebook database but could not find relevant information to answer this specific question. 

Please respond with: "I couldn't find specific information about this topic in the available rulebook content. This might be because:
1. The question relates to a sport not currently in our database
2. The specific scenario isn't covered in the available rules
3. The question might need to be rephrased for better matching

Please try rephrasing your question or ask about specific sports rules that might be in our database (such as baseball, basketball, hockey, etc.)."`;
      }

      console.log('🤖 Step 5: Sending enhanced contextual prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2, // Slightly higher for more natural reasoning
          max_tokens: 1800, // Increased for comprehensive answers
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );

      const aiAnswer = response.data.choices?.[0]?.message?.content?.trim();
      console.log('🤖 Step 6: OpenAI returned answer:', aiAnswer);

      if (!aiAnswer) {
        return { 
          answer: "I couldn't generate a response. Please try rephrasing your question.",
          searchResultsCount: scoredMatches.length 
        };
      }

      return { 
        answer: aiAnswer,
        searchResultsCount: scoredMatches.length,
        sportsFound: [...new Set(scoredMatches.map(m => m.metadata?.sport).filter(Boolean))]
      };

    } catch (error) {
      console.error('❌ Error in answerQuestion:', error);
      throw error;
    }
  },

  processAndRankResults(matches, question) {
    if (!matches || matches.length === 0) {
      console.log('❌ No matches to process');
      return '';
    }

    console.log('🔄 Processing', matches.length, 'matches...');

    const scoredMatches = matches.map((match, index) => {
      let relevanceScore = match.score || 0;
      
      const content = match.metadata?.content || match.metadata?.text || '';
      const matchSport = match.metadata?.sport || '';

      if (!content) {
        console.log(`⚠️ Match ${index + 1} has no content!`);
        return null;
      }

      const questionLower = question.toLowerCase();
      const contentLower = content.toLowerCase();

      // ENHANCED CONTEXTUAL SCORING
      // Water-related questions (likely golf)
      if (questionLower.includes('water') || questionLower.includes('pond') || questionLower.includes('lake')) {
        if (matchSport.toLowerCase() === 'golf') {
          if (contentLower.includes('water hazard') || contentLower.includes('penalty area') || 
              contentLower.includes('lateral water hazard') || contentLower.includes('yellow stakes') ||
              contentLower.includes('red stakes')) {
            relevanceScore += 0.5; // Strong boost for golf water hazard rules
            console.log(`🎯 Strong golf water hazard boost for match ${index + 1}`);
          }
        }
      }

      // Fence/boundary questions (likely baseball)
      if (questionLower.includes('fence') || questionLower.includes('over the fence') || 
          questionLower.includes('boundary') || questionLower.includes('home run')) {
        if (matchSport.toLowerCase() === 'baseball') {
          if (contentLower.includes('home run') || contentLower.includes('fence') || 
              contentLower.includes('boundary') || contentLower.includes('foul territory')) {
            relevanceScore += 0.5;
            console.log(`🎯 Strong baseball boundary boost for match ${index + 1}`);
          }
        }
      }

      // Out of bounds questions (multiple sports, but context-dependent)
      if (questionLower.includes('out of bounds') || questionLower.includes('out-of-bounds')) {
        // Small boost to any sport with out of bounds rules
        if (contentLower.includes('out of bounds') || contentLower.includes('boundary')) {
          relevanceScore += 0.2;
        }
      }

      // Enhanced keyword matching with sport-specific terms
      const questionWords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 2 && !this.isStopWord(word));

      let keywordMatches = 0;
      questionWords.forEach(word => {
        if (contentLower.includes(word)) {
          keywordMatches++;
        } else if (this.findSimilarWord(word, contentLower)) {
          keywordMatches += 0.5; // Partial credit for similar terms
        }
      });
      
      if (keywordMatches > 0) {
        relevanceScore += (keywordMatches * 0.06);
      }

      // Boost comprehensive content
      if (content.length > 300) {
        relevanceScore += 0.04;
      } else if (content.length > 150) {
        relevanceScore += 0.02;
      }

      console.log(`🔍 Match ${index + 1}: ${matchSport} - Score: ${relevanceScore.toFixed(3)} (Original: ${match.score?.toFixed(3)}, Keywords: ${keywordMatches})`);

      return {
        ...match,
        relevanceScore,
        content,
        sport: matchSport,
        keywordMatches
      };
    }).filter(Boolean);

    // Sort by relevance score (highest first)
    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log('🎯 Final ranked results by sport:');
    const sportGroups = {};
    scoredMatches.forEach(m => {
      const sport = m.sport || 'Unknown';
      if (!sportGroups[sport]) sportGroups[sport] = [];
      sportGroups[sport].push(m.relevanceScore.toFixed(3));
    });
    Object.entries(sportGroups).forEach(([sport, scores]) => {
      console.log(`  - ${sport}: ${scores.slice(0, 3).join(', ')}${scores.length > 3 ? '...' : ''}`);
    });

    // Return top results with clear prioritization
    const result = scoredMatches
      .slice(0, 10) // Get top 10 for comprehensive context
      .map((m, index) => {
        const sportLabel = m.sport?.toUpperCase() || 'GENERAL';
        const scoreInfo = `(Relevance: ${m.relevanceScore.toFixed(3)})`;
        const priority = index === 0 ? '🏆 PRIMARY: ' : index < 3 ? '⭐ ' : '• ';
        return `${priority}[${sportLabel}] ${scoreInfo}\n${m.content.trim()}`;
      })
      .join('\n\n---\n\n');
    
    console.log('🎯 Final processed result length:', result.length);
    return result;
  },

  findSimilarWord(targetWord, content) {
    const termMappings = {
      'water': ['water hazard', 'pond', 'lake', 'stream', 'river', 'lateral water hazard', 'penalty area', 'yellow stakes', 'red stakes'],
      'ball': ['golf ball', 'ball in water', 'lost ball', 'ball in play', 'baseball', 'basketball'],
      'hit': ['stroke', 'shot', 'play', 'strike', 'swing', 'contact'],
      'penalty': ['penalty stroke', 'drop', 'relief', 'one-stroke penalty', 'two-stroke penalty'],
      'fence': ['boundary', 'home run', 'foul territory', 'out of play', 'wall', 'barrier'],
      'goal': ['field goal', 'touchdown', 'scoring', 'endzone', 'goalpost', 'goal line'],
      'field': ['field goal', 'playing field', 'football field', 'gridiron', 'court', 'pitch'],
      'down': ['first down', 'second down', 'third down', 'fourth down', 'downs', 'possession'],
      'player': ['players', 'team member', 'athlete', 'golfer', 'batter', 'quarterback'],
      'score': ['scoring', 'points', 'touchdown', 'field goal', 'par', 'birdie', 'run', 'basket'],
      'time': ['clock', 'timer', 'timeout', 'quarter', 'period', 'half', 'overtime'],
      'pass': ['passing', 'throw', 'forward pass', 'incomplete', 'completion'],
      'run': ['running', 'rush', 'carry', 'ground game', 'rushing'],
      'bounds': ['boundary', 'out of bounds', 'sideline', 'baseline', 'perimeter'],
      'foul': ['foul ball', 'personal foul', 'technical foul', 'flagrant', 'violation']
    };

    const mappings = termMappings[targetWord.toLowerCase()] || [];
    return mappings.some(term => content.includes(term));
  },

  findPartialMatch(targetWord, content) {
    if (targetWord.length < 4) return false;
    
    const words = content.split(/\s+/);
    return words.some(word => {
      const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
      return (cleanWord.length > 3 && (cleanWord.includes(targetWord) || targetWord.includes(cleanWord)));
    });
  },

  isStopWord(word) {
    const stopWords = [
      'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'can', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
      'what', 'which', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'a', 'an', 'as', 'at', 'by',
      'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with', 'about', 'happens'
    ];
    return stopWords.includes(word.toLowerCase());
  },

  async getEmbedding(text) {
    try {
      const processedText = this.preprocessTextForEmbedding(text);

      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: processedText,
          model: 'text-embedding-3-small',
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );

      return response.data.data?.[0]?.embedding;
    } catch (error) {
      console.error('❌ Error getting embedding:', error);
      throw error;
    }
  },

  preprocessTextForEmbedding(text) {
    // Enhanced preprocessing for better embedding quality
    return text.trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\?]/g, '') // Remove punctuation except question marks
      .toLowerCase();
  }
};