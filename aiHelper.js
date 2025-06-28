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

      const CONFIDENCE_THRESHOLD = 0.75;

      const topChunks = this.processAndRankResults(scoredMatches, sport, question);
      const hasGoodRulebookContent = topChunks && topChunks.trim().length > 100;

      let prompt;

      if (topScore >= CONFIDENCE_THRESHOLD && hasGoodRulebookContent) {
        console.log('✅ Confident rulebook content found, restricting answer to rulebook...');
        prompt = `You are a sports rulebook expert. You can ONLY answer using the provided rulebook content. 
If the rulebook content does not contain enough information, simply say: 
"I couldn't find relevant information in the rulebook to answer your question."

RULEBOOK CONTENT:
${topChunks}

QUESTION: ${question}

ANSWER:`;
      } else {
        console.log('⚠️ Rulebook match weak or missing, using OpenAI general knowledge...');
        prompt = `You are a sports rulebook and general sports expert. The provided rulebook content may help answer the user's question, but you may also use your own knowledge to assist.

If the rulebook content is incomplete, use your general sports knowledge to provide the most accurate, helpful answer possible. 

RULEBOOK CONTENT (if any):
${topChunks || 'None provided'}

QUESTION: ${question}

ANSWER:`;
      }

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
