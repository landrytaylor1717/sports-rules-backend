import axios from 'axios';

export default {
  // Add sport detection method
  detectSportFromQuestion(question) {
    const sportKeywords = {
      'golf': ['water hazard', 'green', 'tee', 'fairway', 'putt', 'golf ball', 'stroke', 'par', 'birdie', 'eagle', 'bunker', 'rough', 'club'],
      'baseball': ['pitcher', 'batter', 'home plate', 'base', 'inning', 'strike', 'ball count', 'foul ball', 'home run', 'diamond'],
      'football': ['touchdown', 'field goal', 'down', 'yard', 'quarterback', 'snap', 'penalty', 'endzone'],
      'basketball': ['basket', 'hoop', 'court', 'dribble', 'foul', 'free throw', 'rebound', 'three-pointer'],
      'tennis': ['serve', 'court', 'net', 'set', 'match', 'deuce', 'advantage', 'ace'],
      'soccer': ['goal', 'offside', 'penalty kick', 'yellow card', 'red card', 'corner kick', 'free kick']
    };

    const questionLower = question.toLowerCase();
    
    // Check for explicit sport mentions first
    for (const [sport, keywords] of Object.entries(sportKeywords)) {
      if (questionLower.includes(sport)) {
        console.log(`🎯 Detected sport from explicit mention: ${sport}`);
        return sport;
      }
    }

    // Then check for sport-specific keywords
    const sportScores = {};
    for (const [sport, keywords] of Object.entries(sportKeywords)) {
      sportScores[sport] = keywords.filter(keyword => 
        questionLower.includes(keyword.toLowerCase())
      ).length;
    }

    // Find sport with highest keyword matches
    const bestSport = Object.entries(sportScores)
      .filter(([_, score]) => score > 0)
      .sort(([_, a], [__, b]) => b - a)[0];

    if (bestSport && bestSport[1] > 0) {
      console.log(`🎯 Detected sport from keywords: ${bestSport[0]} (${bestSport[1]} matches)`);
      return bestSport[0];
    }

    console.log('🤷 No specific sport detected');
    return null;
  },

  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      console.log('🤖 Step 1: Getting embedding...');
      
      // Auto-detect sport if not provided
      const detectedSport = sport || this.detectSportFromQuestion(question);
      console.log('🏀 Using sport:', detectedSport || 'none');

      const embedding = await this.getEmbedding(question);
      console.log('🤖 Step 2: Got embedding of length:', embedding.length);

      const queryParams = {
        vector: embedding,
        topK: 8,
        includeMetadata: true,
      };

      if (detectedSport) {
        queryParams.filter = {
          sport: { "$eq": detectedSport }
        };
        console.log('🏀 Applying sport filter:', detectedSport);
      }

      console.log('🤖 Step 3: Querying Pinecone with params:', queryParams);
      const queryResponse = await pineconeIndex.query(queryParams);
      console.log('🤖 Step 4: Pinecone returned', queryResponse.matches?.length || 0, 'matches');
      
      // DEBUG: Log first few matches to see what we're getting
      if (queryResponse.matches?.length > 0) {
        console.log('🔍 DEBUG: First match details:');
        console.log('  - Score:', queryResponse.matches[0].score);
        console.log('  - Sport:', queryResponse.matches[0].metadata?.sport);
        console.log('  - Content preview:', queryResponse.matches[0].metadata?.content?.substring(0, 150) + '...');
      } else {
        console.log('❌ DEBUG: No matches returned from Pinecone');
      }

      let fallbackResults = null;
      if (detectedSport && queryResponse.matches.length < 2) {
        console.log('🔄 Few sport-specific results, trying fallback without filter...');
        fallbackResults = await pineconeIndex.query({
          vector: embedding,
          topK: 8,
          includeMetadata: true,
        });
        console.log('🔄 Fallback returned', fallbackResults.matches?.length || 0, 'matches');
      }

      const finalResults = (fallbackResults && fallbackResults.matches.length > queryResponse.matches.length)
        ? fallbackResults
        : queryResponse;

      const scoredMatches = finalResults.matches || [];
      const topScore = scoredMatches[0]?.score || 0;

      console.log(`🎯 Top result score: ${topScore.toFixed(3)}`);

      const CONFIDENCE_THRESHOLD = 0.2;
      const MIN_CONTENT_LENGTH = 15;

      const topChunks = this.processAndRankResults(scoredMatches, detectedSport, question);

      console.log('🔍 Top chunks preview:', topChunks.substring(0, 200) + '...');
      console.log('🔍 Top chunks length:', topChunks.length);

      let prompt;

      if (scoredMatches.length > 0 && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content...');
        
        // Enhanced prompt with sport context
        prompt = `You are a sports rulebook assistant. Answer the question using ONLY the information provided in the rulebook content below. 

${detectedSport ? `SPORT CONTEXT: This question appears to be about ${detectedSport.toUpperCase()}.` : ''}

CRITICAL INSTRUCTIONS:
- Base your answer ENTIRELY on the rulebook content provided
- If the rulebook content directly addresses the specific question, provide that exact answer
- If the rulebook doesn't specifically address the question but contains related/analogous rules, clearly state: "The rulebook doesn't specifically address [specific scenario], but it does contain related rules that may apply:"
- Then explain the related rules and how they might apply to the situation
- Provide comprehensive, detailed answers when the content supports it
- Include relevant context, examples, and specific rule citations when available
- If multiple sports are represented in the content, prioritize the most relevant sport based on the question context
- When multiple rule sections are relevant, explain how they work together
- Include any important exceptions, conditions, or special cases mentioned in the content

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

Based on the rulebook content above, provide a comprehensive answer with full details and context:`;
      } else {
        console.log('⚠️ No content found...');
        const sportHint = detectedSport ? ` about ${detectedSport}` : '';
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I searched the sports rulebook database${sportHint} but could not find relevant information to answer this question. 

Please respond with: "I couldn't find information about this topic in the available rulebook content${sportHint}. Please try rephrasing your question or ask about specific sports rules and regulations that might be covered in the database."`;
      }

      console.log('🤖 Step 5: Sending prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
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
        detectedSport: detectedSport,
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
      
      console.log(`🔍 Match ${index + 1}:`, {
        score: match.score,
        sport: match.metadata?.sport,
        contentPreview: match.metadata?.content?.substring(0, 50) + '...' || 'NO CONTENT'
      });
      
      const content = match.metadata?.content || match.metadata?.text || '';
      const matchSport = match.metadata?.sport || '';

      if (!content) {
        console.log(`⚠️ Match ${index + 1} has no content!`);
      }

      // Boost sport-specific matches MORE aggressively
      if (sport && matchSport.toLowerCase() === sport.toLowerCase()) {
        relevanceScore += 0.3; // Increased from 0.1
        console.log(`🎯 Boosting ${sport} match by 0.3`);
      }

      // Boost longer, more detailed content
      if (content.length > 200) {
        relevanceScore += 0.05;
      }

      // Enhanced keyword matching
      const questionWords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 2 && !this.isStopWord(word));

      const contentLower = content.toLowerCase();
      const keywordMatches = questionWords.filter(word => 
        contentLower.includes(word) || 
        this.findSimilarWord(word, contentLower) ||
        this.findPartialMatch(word, contentLower)
      ).length;
      
      if (keywordMatches > 0) {
        relevanceScore += (keywordMatches * 0.05);
      }

      return {
        ...match,
        relevanceScore,
        content,
        sport: matchSport,
        keywordMatches
      };
    });

    // Sort by relevance score (sport-boosted matches should now rank higher)
    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log('🎯 Ranked results:', scoredMatches.map(m => ({
      sport: m.sport,
      score: m.relevanceScore.toFixed(3),
      originalScore: m.score?.toFixed(3),
      keywordMatches: m.keywordMatches
    })));

    // Return top results with sport prioritization
    const result = scoredMatches
      .slice(0, 6)
      .filter(m => m.content)
      .map((m, index) => {
        const sportLabel = m.sport?.toUpperCase() || 'GENERAL';
        const scoreInfo = `(Score: ${m.relevanceScore.toFixed(3)})`;
        return `[${sportLabel}] ${scoreInfo}\n${m.content.trim()}`;
      })
      .join('\n\n---\n\n');
    
    console.log('🎯 Final processed result length:', result.length);
    return result;
  },

  // Enhanced similarity matching with water hazard terms
  findSimilarWord(targetWord, content) {
    const termMappings = {
      'water': ['water hazard', 'pond', 'lake', 'stream', 'river', 'lateral water hazard'],
      'ball': ['golf ball', 'ball in water', 'lost ball'],
      'hit': ['stroke', 'shot', 'play'],
      'penalty': ['penalty stroke', 'drop', 'relief'],
      'goal': ['field goal', 'touchdown', 'scoring', 'endzone', 'goalpost'],
      'field': ['field goal', 'playing field', 'football field', 'gridiron'],
      'down': ['first down', 'second down', 'third down', 'fourth down', 'downs'],
      'player': ['players', 'team member', 'athlete'],
      'score': ['scoring', 'points', 'touchdown', 'field goal'],
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
  },

  async testSportEnhancement(question, sport) {
    const embedding = await this.getEmbedding(question);
    return {
      originalQuestion: question,
      detectedSport: sport || this.detectSportFromQuestion(question),
      processedText: this.preprocessTextForEmbedding(question),
      embeddingLength: embedding.length
    };
  }
};