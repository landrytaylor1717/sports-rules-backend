import axios from 'axios';
import { detectSportFromQuestion } from './utils/sportDetection.js';

export default {
  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      console.log('🤖 Step 1: Getting embedding...');
      const embedding = await this.getEmbedding(question);
      console.log('🤖 Step 2: Got embedding of length:', embedding.length);

      const detectedSport = detectSportFromQuestion(question);
      if (detectedSport) {
        console.log(`🎯 Term-based detected sport: ${detectedSport}. Prioritizing ${detectedSport} chunks.`);
      }

      const queryParams = {
        vector: embedding,
        topK: 15,
        includeMetadata: true,
        ...(detectedSport ? { filter: { sport: detectedSport } } : {}),
      };

      console.log('🤖 Step 3: Querying Pinecone...');
      const queryResponse = await pineconeIndex.query(queryParams);
      console.log('🤖 Step 4: Pinecone returned', queryResponse.matches?.length || 0, 'matches');

      if (queryResponse.matches?.length > 0) {
        console.log('🔍 DEBUG: Available sports in results:');
        const sportsFound = [...new Set(queryResponse.matches.map(m => m.metadata?.sport).filter(Boolean))];
        console.log('  - Sports found:', sportsFound);
      }

      const scoredMatches = queryResponse.matches || [];
      const topScore = scoredMatches[0]?.score || 0;
      console.log(`🎯 Top result score: ${topScore.toFixed(3)}`);

      const topChunks = this.processAndRankResults(scoredMatches, question, detectedSport);
      console.log('🔍 Top chunks length:', topChunks.length);

      let prompt;
      const MIN_CONTENT_LENGTH = 15;

      if (scoredMatches.length > 0 && topChunks.trim().length > MIN_CONTENT_LENGTH) {
        console.log('✅ Using rulebook content with enhanced contextual reasoning...');

        prompt = `You are an expert sports rulebook assistant with access to official rules from multiple sports. Your job is to provide the most accurate and contextually appropriate answer.

CRITICAL ANALYSIS PROCESS:
1. Identify the most likely sport the question refers to.
2. Prioritize rules from that sport.
3. Provide a clear, complete answer based on those rules.

QUESTION: "${question}"

AVAILABLE RULEBOOK CONTENT:
${topChunks}

Answer:`;

      } else {
        console.log('⚠️ No relevant content found...');
        prompt = `You are a sports rulebook assistant. The user asked: "${question}"

I searched the sports rulebook database but could not find relevant information to answer this specific question.

Respond with: "I couldn't find specific information about this topic in the available rulebook content. Please try rephrasing your question or ask about specific sports rules that might be in our database."`;
      }

      console.log('🤖 Step 5: Sending prompt to OpenAI...');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1800,
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );

      const aiAnswer = response.data.choices?.[0]?.message?.content?.trim();
      console.log('🤖 Step 6: OpenAI returned answer:', aiAnswer);

      return {
        answer: aiAnswer || "I couldn't generate a response. Please try rephrasing your question.",
        searchResultsCount: scoredMatches.length,
        sportsFound: [...new Set(scoredMatches.map(m => m.metadata?.sport).filter(Boolean))]
      };

    } catch (error) {
      console.error('❌ Error in answerQuestion:', error);
      throw error;
    }
  },

  processAndRankResults(matches, question, detectedSport = null) {
    if (!matches?.length) return '';

    console.log('🔄 Processing', matches.length, 'matches...');

    const scoredMatches = matches.map((match, index) => {
      let relevanceScore = match.score || 0;
      const content = match.metadata?.content || '';
      const matchSport = match.metadata?.sport || '';

      if (detectedSport && matchSport.toLowerCase() === detectedSport.toLowerCase()) {
        relevanceScore += 0.7;
      }

      const questionLower = question.toLowerCase();
      const contentLower = content.toLowerCase();

      if (questionLower.includes('water') && matchSport.toLowerCase() === 'golf' && contentLower.includes('water hazard')) {
        relevanceScore += 0.5;
      }

      if (questionLower.includes('fence') && matchSport.toLowerCase() === 'baseball' && contentLower.includes('home run')) {
        relevanceScore += 0.5;
      }

      if (content.length > 300) relevanceScore += 0.04;
      else if (content.length > 150) relevanceScore += 0.02;

      return {
        ...match,
        relevanceScore,
        content,
        sport: matchSport
      };
    });

    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log('🎯 Final ranked results:');
    scoredMatches.forEach((m, i) => {
      console.log(`  ${i + 1}. [${m.sport || 'Unknown'}] Score: ${m.relevanceScore.toFixed(3)}`);
    });

    return scoredMatches.slice(0, 10).map((m, i) => {
      const label = m.sport?.toUpperCase() || 'GENERAL';
      const priority = i === 0 ? '🏆 PRIMARY: ' : i < 3 ? '⭐ ' : '• ';
      return `${priority}[${label}] (Relevance: ${m.relevanceScore.toFixed(3)})\n${m.content.trim()}`;
    }).join('\n\n---\n\n');
  },

  async getEmbedding(text) {
    const processedText = text.trim().replace(/\s+/g, ' ').replace(/[^\w\s\?]/g, '').toLowerCase();

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
  }
};
