import axios from 'axios';

export default {
  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      console.log('🤖 Step 1: Getting embedding...');
      const embedding = await this.getEmbedding(question);
      console.log('🤖 Step 2: Got embedding of length:', embedding.length);

      // First, get results from ALL sports (no filtering initially)
      const queryParams = {
        vector: embedding,
        topK: 12, // Get more results to have options from different sports
        includeMetadata: true,
      };

      console.log('🤖 Step 3: Querying Pinecone (all sports)...');
      const queryResponse = await pineconeIndex.query(queryParams);
      console.log('🤖 Step 4: Pinecone returned', queryResponse.matches?.length || 0, 'matches');
      
      if (queryResponse.matches?.length > 0) {
        console.log('🔍 DEBUG: Available sports in results:');
        const sportsFound = [...new Set(queryResponse.matches.map(m => m.metadata?.sport).filter(Boolean))];
        console.log('  - Sports found:', sportsFound);
        
        queryResponse.matches.slice(0, 3).forEach((match, i) => {
          console.log(`  - Match ${i + 1}: ${match.metadata?.sport || 'Unknown'} (Score: ${match.score?.toFixed(3)})`);
        });
      }

      const scoredMatches = queryResponse.matches || [];
      const topScore = scoredMatches[0]?.score || 0;
      console.log(`🎯 Top result score: ${topScore.toFixed(3)}`);

      const MIN_CONTENT_LENGTH = 15;
      const topChunks = this.processAndRankResults(scoredMatches, null, question);

      console.log('🔍 Top chunks length:', topChunks.length);

      let prompt;

      if (scoredMatches.length > 0 && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content with contextual reasoning...');
        
        // This is the KEY CHANGE - let the AI reason about context
        prompt = `You are an intelligent sports rulebook assistant. You have access to rules from multiple sports, and you need to provide the most contextually appropriate answer.

CRITICAL INSTRUCTIONS:
1. **CONTEXT REASONING**: Look at the question and determine which sport it most likely refers to based on the terminology and scenario described.

2. **SPORT PRIORITIZATION**: When you have rulebook content from multiple sports that could theoretically apply, prioritize the sport that makes the most sense given the specific question context.

3. **NATURAL INFERENCE**: Just like a human expert would do, use common sense about which sport the person is most likely asking about. For example:
   - "Ball hit into water" → Most likely golf (water hazards)
   - "Ball over the fence" → Most likely baseball (home runs)
   - "Ball out of bounds" → Could be multiple sports, look for other clues

4. **COMPREHENSIVE ANSWERS**: Once you've identified the most appropriate sport, provide detailed, complete answers using that sport's rules.

5. **ACKNOWLEDGE ALTERNATIVES**: If multiple sports could apply, briefly mention this but lead with the most likely interpretation.

QUESTION: ${question}

AVAILABLE RULEBOOK CONTENT FROM MULTIPLE SPORTS:
${topChunks}

Based on the question context and the rulebook content above, provide a comprehensive answer. Start by identifying which sport this question most likely refers to, then provide the detailed rules and procedures for that sport:`;

      } else {
        console.log('⚠️ No content found...');
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I searched the sports rulebook database but could not find relevant information to answer this question. 

Please respond with: "I couldn't find information about this topic in the available rulebook content. Please try rephrasing your question or ask about specific sports rules and regulations that might be covered in the database."`;
      }

      console.log('🤖 Step 5: Sending contextual prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1, // Lower temperature for more consistent reasoning
          max_tokens: 1500,
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );

      const aiAnswer = response.data.choices?.[0]?.message?.content?.trim();
      console.log('🤖 Step 6: OpenAI returned answer:', aiAnswer);

      if (!aiAnswer) {
        return { answer: "I couldn't find relevant information in the rulebook to answer your question." };
      }

      return { 
        answer: aiAnswer,
        searchResultsCount: scoredMatches.length
      };

    } catch (error) {
      console.error('❌ Error in answerQuestion:', error);
      throw error;
    }
  },

  processAndRankResults(matches, sport, question) {
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

      // Enhanced contextual scoring based on question content
      const questionLower = question.toLowerCase();
      const contentLower = content.toLowerCase();

      // Context-specific boosting
      if (questionLower.includes('water')) {
        if (matchSport.toLowerCase() === 'golf' && 
            (contentLower.includes('water hazard') || contentLower.includes('penalty') || contentLower.includes('drop'))) {
          relevanceScore += 0.4; // Strong boost for golf water hazard rules
        }
      }

      if (questionLower.includes('fence') || questionLower.includes('over')) {
        if (matchSport.toLowerCase() === 'baseball' && 
            (contentLower.includes('home run') || contentLower.includes('fence') || contentLower.includes('boundary'))) {
          relevanceScore += 0.4; // Strong boost for baseball boundary rules
        }
      }

      // General keyword matching
      const questionWords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 2 && !this.isStopWord(word));

      const keywordMatches = questionWords.filter(word => 
        contentLower.includes(word) || 
        this.findSimilarWord(word, contentLower) ||
        this.findPartialMatch(word, contentLower)
      ).length;
      
      if (keywordMatches > 0) {
        relevanceScore += (keywordMatches * 0.05);
      }

      // Boost longer, more detailed content
      if (content.length > 200) {
        relevanceScore += 0.03;
      }

      console.log(`🔍 Match ${index + 1}: ${matchSport} - Score: ${relevanceScore.toFixed(3)} (Original: ${match.score?.toFixed(3)})`);

      return {
        ...match,
        relevanceScore,
        content,
        sport: matchSport,
        keywordMatches
      };
    }).filter(Boolean); // Remove null entries

    // Sort by relevance score
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

    // Return top 8 results with clear sport labeling
    const result = scoredMatches
      .slice(0, 8) // Get top 8 for comprehensive context
      .map((m, index) => {
        const sportLabel = m.sport?.toUpperCase() || 'GENERAL';
        const scoreInfo = `(Relevance: ${m.relevanceScore.toFixed(3)})`;
        const priority = index < 3 ? '⭐ ' : ''; // Mark top 3 as priority
        return `${priority}[${sportLabel}] ${scoreInfo}\n${m.content.trim()}`;
      })
      .join('\n\n---\n\n');
    
    console.log('🎯 Final processed result length:', result.length);
    return result;
  },

  findSimilarWord(targetWord, content) {
    const termMappings = {
      'water': ['water hazard', 'pond', 'lake', 'stream', 'river', 'lateral water hazard', 'penalty area'],
      'ball': ['golf ball', 'ball in water', 'lost ball', 'ball in play'],
      'hit': ['stroke', 'shot', 'play', 'strike'],
      'penalty': ['penalty stroke', 'drop', 'relief', 'one-stroke penalty'],
      'fence': ['boundary', 'home run', 'foul territory', 'out of play'],
      'goal': ['field goal', 'touchdown', 'scoring', 'endzone', 'goalpost'],
      'field': ['field goal', 'playing field', 'football field', 'gridiron'],
      'down': ['first down', 'second down', 'third down', 'fourth down', 'downs'],
      'player': ['players', 'team member', 'athlete', 'golfer', 'batter'],
      'score': ['scoring', 'points', 'touchdown', 'field goal', 'par', 'birdie'],
      'time': ['clock', 'timer', 'timeout', 'quarter', 'period'],
      'pass': ['passing', 'throw', 'forward pass', 'incomplete'],
      'run': ['running', 'rush', 'carry', 'ground game']
    };

    const mappings = termMappings[targetWord.toLowerCase()] || [];
    return mappings.some(term => content.includes(term));
  },

  findPartialMatch(targetWord, content) {
    if (targetWord.length < 4) return false;
    
    const words = content.split(/\s+/);
    return words.some(word => {
      const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
      return cleanWord.includes(targetWord) || targetWord.includes(cleanWord);
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
      'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with', 'about'
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
    return text.trim().replace(/\s+/g, ' ');
  }
};