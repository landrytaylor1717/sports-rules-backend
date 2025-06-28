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

      // Threshold for confidence in rulebook content
      const CONFIDENCE_THRESHOLD = 0.75;

      if (topScore < CONFIDENCE_THRESHOLD) {
        console.log('⚠️ No strong rulebook match, using OpenAI general knowledge...');
        const generalResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: `You are a sports expert. Answer this question clearly and accurately:\n\n${question}` }],
            temperature: 0.2,
            max_tokens: 800,
          },
          {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          }
        );

        const aiAnswer = generalResponse.data.choices?.[0]?.message?.content?.trim();
        return { answer: aiAnswer || "I couldn't generate a clear answer." };
      }

      // Process rulebook content normally
      const topChunks = this.processAndRankResults(scoredMatches, sport, question);

      if (!topChunks || topChunks.trim().length === 0) {
        return { answer: "I couldn't find relevant information in the rulebook to answer your question." };
      }

      const prompt = this.buildEnhancedPrompt(topChunks, question, sport);

      console.log('🤖 Step 5: Sending prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 800,
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );

      const aiAnswer = response.data.choices?.[0]?.message?.content?.trim();
      console.log('🤖 Step 6: OpenAI returned answer:', aiAnswer);

      if (!aiAnswer) {
        return { answer: "I couldn't generate a clear answer based on the rulebook content." };
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

      if (sport && matchSport.toLowerCase() === sport.toLowerCase()) {
        relevanceScore += 0.1;
      }

      if (content.length > 200) {
        relevanceScore += 0.05;
      }

      const questionWords = question.toLowerCase().split(' ').filter(word => word.length > 3);
      const contentLower = content.toLowerCase();
      const keywordMatches = questionWords.filter(word => contentLower.includes(word)).length;
      relevanceScore += (keywordMatches * 0.02);

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

  buildEnhancedPrompt(topChunks, question, sport) {
    const sportContext = sport ? `The user is asking specifically about ${sport} rules. ` : '';
    return `You are a comprehensive sports rule expert with deep knowledge across all major sports. ${sportContext}Using the following rulebook content, answer the user's question clearly and accurately.

IMPORTANT INSTRUCTIONS:
- Focus on the specific sport mentioned in the question
- If multiple sports are referenced in the content, prioritize the one most relevant to the question
- Provide specific rule numbers, sections, or official terminology when available
- Be precise and cite the exact rules when possible
- If the content doesn't fully answer the question, say so clearly
- Do not invent or assume information not found in the provided rules

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

ANSWER:`;
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
