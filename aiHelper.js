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

      // Lower the threshold and add more validation
      const CONFIDENCE_THRESHOLD = 0.65; // Lowered from 0.75
      const MIN_CONTENT_LENGTH = 50; // Reduced from 100

      const topChunks = this.processAndRankResults(scoredMatches, sport, question);
      const hasRelevantContent = this.validateRulebookContent(topChunks, question);

      // Always restrict to rulebook content - no general knowledge fallback
      let prompt;

      if (topScore >= CONFIDENCE_THRESHOLD && hasRelevantContent) {
        console.log('✅ Relevant rulebook content found...');
        prompt = `You are a sports rulebook assistant. Answer ONLY using the provided rulebook content below. Do not use any outside knowledge or make assumptions.

If the rulebook content doesn't fully answer the question, say: "Based on the available rulebook information, I can only provide a partial answer" and then provide what information is available.

If the content is completely unrelated to the question, say: "I couldn't find relevant information in the rulebook to answer your question."

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

ANSWER (using only the rulebook content above):`;
      } else {
        console.log('⚠️ No relevant rulebook content found...');
        // Don't provide any context that might lead to general answers
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I could not find relevant information in the sports rulebook database to answer this question. 

Please respond with: "I couldn't find relevant information in the rulebook to answer your question. Please ask about specific sports rules and regulations that would be found in official rulebooks."`;
      }

      console.log('🤖 Step 5: Sending prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1, // Lower temperature for more consistent responses
          max_tokens: 600, // Reduced since we're being more restrictive
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

  // New method to better validate if content is relevant to the question
  validateRulebookContent(content, question) {
    if (!content || content.trim().length < 50) {
      return false;
    }

    // Extract key terms from the question
    const questionWords = question.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2 && !this.isStopWord(word));

    const contentLower = content.toLowerCase();

    // Check if at least 2 key terms from question appear in content
    const matchingWords = questionWords.filter(word => 
      contentLower.includes(word)
    );

    console.log('🔍 Question words:', questionWords);
    console.log('🔍 Matching words:', matchingWords);

    // Also check for sports rule-related keywords in content
    const ruleKeywords = [
      'rule', 'regulation', 'foul', 'penalty', 'violation', 'legal', 'illegal',
      'player', 'team', 'game', 'match', 'court', 'field', 'ball', 'official',
      'referee', 'umpire', 'timeout', 'substitution', 'score', 'point'
    ];

    const hasRuleKeywords = ruleKeywords.some(keyword => 
      contentLower.includes(keyword)
    );

    return matchingWords.length >= 2 || hasRuleKeywords;
  },

  // Helper method to identify common stop words
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
        relevanceScore += 0.15; // Increased boost
      }

      // Boost longer, more detailed content
      if (content.length > 200) {
        relevanceScore += 0.08;
      }

      // More sophisticated keyword matching
      const questionWords = question.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 3 && !this.isStopWord(word));

      const contentLower = content.toLowerCase();
      const keywordMatches = questionWords.filter(word => contentLower.includes(word)).length;
      relevanceScore += (keywordMatches * 0.05); // Increased weight

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
      contentLength: m.content.length
    })));

    return scoredMatches
      .slice(0, 3)
      .map(m => `[${m.sport?.toUpperCase() || 'GENERAL'}] ${m.content}`)
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