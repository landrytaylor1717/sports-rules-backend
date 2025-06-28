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

      // More reasonable thresholds
      const CONFIDENCE_THRESHOLD = 0.5; // Lowered from 0.65
      const MIN_CONTENT_LENGTH = 30; // Lowered from 50

      const topChunks = this.processAndRankResults(scoredMatches, sport, question);
      const hasRelevantContent = this.validateRulebookContent(topChunks, question);

      console.log('🔍 Content validation result:', hasRelevantContent);
      console.log('🔍 Top chunks preview:', topChunks.substring(0, 200) + '...');

      let prompt;

      // More lenient conditions - if we have ANY reasonable matches, use them
      if ((topScore >= CONFIDENCE_THRESHOLD || scoredMatches.length > 0) && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content...');
        prompt = `You are a sports rulebook assistant. Answer using the provided rulebook content below. 

If the content directly answers the question, provide a clear, complete answer.
If the content only partially answers the question, provide what information is available and note what's missing.
If the content seems unrelated, say you couldn't find relevant information.

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

ANSWER:`;
      } else {
        console.log('⚠️ No relevant rulebook content found...');
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
          temperature: 0.2, // Slightly higher for more natural responses
          max_tokens: 800, // Increased for more complete answers
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

  // Improved validation - less strict but still focused on rulebook content
  validateRulebookContent(content, question) {
    if (!content || content.trim().length < 20) {
      console.log('🔍 Validation failed: Content too short');
      return false;
    }

    // Extract key terms from the question (keep important words only)
    const questionWords = question.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2 && !this.isStopWord(word));

    const contentLower = content.toLowerCase();

    // Check if at least 1 key term from question appears in content (was 2, too strict)
    const matchingWords = questionWords.filter(word => 
      contentLower.includes(word) || this.findSimilarWord(word, contentLower)
    );

    console.log('🔍 Question words:', questionWords);
    console.log('🔍 Matching words:', matchingWords);

    // Check for sports rule-related keywords in content
    const ruleKeywords = [
      'rule', 'regulation', 'foul', 'penalty', 'violation', 'legal', 'illegal',
      'player', 'team', 'game', 'match', 'court', 'field', 'ball', 'official',
      'referee', 'umpire', 'timeout', 'substitution', 'score', 'point', 'goal',
      'down', 'yard', 'quarter', 'period', 'inning', 'set', 'serve', 'shot'
    ];

    const hasRuleKeywords = ruleKeywords.some(keyword => 
      contentLower.includes(keyword)
    );

    console.log('🔍 Has rule keywords:', hasRuleKeywords);
    
    // More lenient validation: pass if we have matching words OR rule keywords
    const isValid = matchingWords.length >= 1 || hasRuleKeywords;
    console.log('🔍 Final validation result:', isValid);
    
    return isValid;
  },

  // Helper to find similar words (basic fuzzy matching)
  findSimilarWord(targetWord, content) {
    if (targetWord === 'goal' && (content.includes('field goal') || content.includes('touchdown'))) {
      return true;
    }
    if (targetWord === 'field' && content.includes('field goal')) {
      return true;
    }
    // Add more specific term mappings as needed
    return false;
  },

  // Updated stop words list
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

  processAndRankResults(matches, sport, question) {
    if (!matches || matches.length === 0) return '';

    const scoredMatches = matches.map(match => {
      let relevanceScore = match.score || 0;
      const content = match.metadata?.content || '';
      const matchSport = match.metadata?.sport || '';

      // Boost sport-specific matches
      if (sport && matchSport.toLowerCase() === sport.toLowerCase()) {
        relevanceScore += 0.15;
      }

      // Boost longer, more detailed content
      if (content.length > 200) {
        relevanceScore += 0.05;
      }

      // Keyword matching with more weight
      const questionWords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 2 && !this.isStopWord(word));

      const contentLower = content.toLowerCase();
      const keywordMatches = questionWords.filter(word => 
        contentLower.includes(word) || this.findSimilarWord(word, contentLower)
      ).length;
      
      relevanceScore += (keywordMatches * 0.08); // Increased weight for keyword matches

      return {
        ...match,
        relevanceScore,
        content,
        sport: matchSport
      };
    });

    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log('🎯 Ranked results:', scoredMatches.map(m => ({
      sport: m.sport,
      score: m.relevanceScore.toFixed(3),
      contentLength: m.content.length,
      originalScore: m.score?.toFixed(3)
    })));

    // Return top 3 results with better formatting
    return scoredMatches
      .slice(0, 3)
      .map(m => {
        const sportLabel = m.sport?.toUpperCase() || 'GENERAL';
        return `[${sportLabel}] ${m.content.trim()}`;
      })
      .join('\n\n---\n\n');
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