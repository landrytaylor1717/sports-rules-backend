import axios from 'axios';

export default {
  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      console.log('🤖 Step 1: Getting embedding...');
      const embedding = await this.getEmbedding(question);
      console.log('🤖 Step 2: Got embedding of length:', embedding.length);

      const queryParams = {
        vector: embedding,
        topK: 5,
        includeMetadata: true,
      };

      if (sport) {
        queryParams.filter = {
          sport: { "$eq": sport }
        };
        console.log('🏀 Applying sport filter:', sport);
      }

      console.log('🤖 Step 3: Querying Pinecone with params:', queryParams);
      const queryResponse = await pineconeIndex.query(queryParams);
      console.log('🤖 Step 4: Pinecone returned', queryResponse.matches?.length || 0, 'matches');

      let fallbackResults = null;
      if (sport && queryResponse.matches.length < 2) {
        console.log('🔄 Few sport-specific results, trying fallback without filter...');
        fallbackResults = await pineconeIndex.query({
          vector: embedding,
          topK: 5,
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

      // MUCH more lenient thresholds
      const CONFIDENCE_THRESHOLD = 0.3; // Lowered from 0.5
      const MIN_CONTENT_LENGTH = 15; // Lowered from 30

      const topChunks = this.processAndRankResults(scoredMatches, sport, question);

      console.log('🔍 Top chunks preview:', topChunks.substring(0, 200) + '...');

      let prompt;

      // Much more lenient conditions - use results if we have ANY matches
      if (scoredMatches.length > 0 && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content...');
        
        // Enhanced prompt for better handling of partial matches
        prompt = `You are a sports rulebook assistant. Use the provided rulebook content to answer the question as best as possible.

IMPORTANT INSTRUCTIONS:
- If the content directly answers the question, provide a clear, complete answer
- If the content only partially relates to the question, extract and present the relevant information
- If multiple pieces of information are provided, organize them clearly
- Always be helpful and informative, even if the match isn't perfect
- If you're unsure about something, acknowledge the uncertainty but still provide available information

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

ANSWER:`;
      } else {
        console.log('⚠️ No content found...');
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I could not find relevant information in the sports rulebook database to answer this question. 

Please respond with: "I couldn't find relevant information in the rulebook to answer your question. Please try rephrasing your question or ask about specific sports rules and regulations."`;
      }

      console.log('🤖 Step 5: Sending prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3, // Balanced for natural but consistent responses
          max_tokens: 1000, // Increased for more complete answers
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

      return { answer: aiAnswer };

    } catch (error) {
      console.error('❌ Error in answerQuestion:', error);
      throw error;
    }
  },

  processAndRankResults(matches, sport, question) {
    if (!matches || matches.length === 0) return '';

    const scoredMatches = matches.map(match => {
      let relevanceScore = match.score || 0;
      const content = match.metadata?.content || '';
      const matchSport = match.metadata?.sport || '';

      // Boost sport-specific matches
      if (sport && matchSport.toLowerCase() === sport.toLowerCase()) {
        relevanceScore += 0.1;
      }

      // Boost longer, more detailed content (but don't penalize shorter content)
      if (content.length > 200) {
        relevanceScore += 0.05;
      }

      // Keyword matching - more generous
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
      
      // Boost keyword matches but don't penalize non-matches too heavily
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

    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log('🎯 Ranked results:', scoredMatches.map(m => ({
      sport: m.sport,
      score: m.relevanceScore.toFixed(3),
      contentLength: m.content.length,
      originalScore: m.score?.toFixed(3),
      keywordMatches: m.keywordMatches
    })));

    // Return top 3-4 results with better formatting
    return scoredMatches
      .slice(0, 4)
      .map((m, index) => {
        const sportLabel = m.sport?.toUpperCase() || 'GENERAL';
        const scoreInfo = `(Score: ${m.relevanceScore.toFixed(3)})`;
        return `[${sportLabel}] ${scoreInfo}\n${m.content.trim()}`;
      })
      .join('\n\n---\n\n');
  },

  // Enhanced similarity matching
  findSimilarWord(targetWord, content) {
    // Sport-specific term mappings
    const termMappings = {
      'goal': ['field goal', 'touchdown', 'scoring', 'endzone', 'goalpost'],
      'field': ['field goal', 'playing field', 'football field', 'gridiron'],
      'down': ['first down', 'second down', 'third down', 'fourth down', 'downs'],
      'penalty': ['foul', 'violation', 'infraction', 'flag'],
      'player': ['players', 'team member', 'athlete'],
      'ball': ['football', 'pigskin', 'possession'],
      'score': ['scoring', 'points', 'touchdown', 'field goal'],
      'time': ['clock', 'timer', 'timeout', 'quarter', 'period'],
      'pass': ['passing', 'throw', 'forward pass', 'incomplete'],
      'run': ['running', 'rush', 'carry', 'ground game']
    };

    const mappings = termMappings[targetWord.toLowerCase()] || [];
    return mappings.some(term => content.includes(term));
  },

  // Add partial matching for flexibility
  findPartialMatch(targetWord, content) {
    if (targetWord.length < 4) return false;
    
    // Look for partial matches in longer words
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
          model: 'text-embedding-ada-002',
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
      detectedSport: sport,
      processedText: this.preprocessTextForEmbedding(question),
      embeddingLength: embedding.length
    };
  }
};