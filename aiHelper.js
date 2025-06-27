import axios from 'axios';

export default {
  async answerQuestion(question, pineconeIndex, sport = null) {
    try {
      // Get embedding for the enhanced question
      const embedding = await this.getEmbedding(question);
      
      // Build query parameters for Pinecone
      const queryParams = {
        vector: embedding,
        topK: 5, // Increased from 3 to get more diverse results
        includeMetadata: true,
      };
      
      // Add sport-specific filtering if sport is detected
      if (sport) {
        queryParams.filter = {
          sport: { "$eq": sport }
        };
        console.log('🏀 Applying sport filter:', sport);
      }
      
      console.log('🔍 Pinecone query params:', queryParams);
      
      const queryResponse = await pineconeIndex.query(queryParams);
      
      console.log('🔍 Pinecone results count:', queryResponse.matches?.length || 0);
      console.log('🔍 Pinecone match scores:', queryResponse.matches?.map(m => m.score) || []);
      
      // If sport-specific search didn't return good results, try without filter
      let fallbackResults = null;
      if (sport && queryResponse.matches.length < 2) {
        console.log('🔄 Sport-specific search had few results, trying fallback...');
        fallbackResults = await pineconeIndex.query({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
        });
        console.log('🔄 Fallback results count:', fallbackResults.matches?.length || 0);
      }
      
      // Use the better result set
      const finalResults = (fallbackResults && fallbackResults.matches.length > queryResponse.matches.length) 
        ? fallbackResults 
        : queryResponse;
      
      // Extract and prioritize content
      const topChunks = this.processAndRankResults(finalResults.matches, sport, question);
      
      if (!topChunks || topChunks.trim().length === 0) {
        return { answer: "I couldn't find relevant information in the rulebook to answer your question." };
      }
      
      // Enhanced prompt with sport context
      const prompt = this.buildEnhancedPrompt(topChunks, question, sport);
      
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
      
      const aiAnswer = response.data.choices[0].message.content.trim();
      return { answer: aiAnswer };
      
    } catch (error) {
      console.error('❌ Error in answerQuestion:', error);
      throw error;
    }
  },

  // Process and rank results based on sport relevance and content quality
  processAndRankResults(matches, sport, question) {
    if (!matches || matches.length === 0) {
      return '';
    }
    
    // Score and sort matches
    const scoredMatches = matches.map(match => {
      let relevanceScore = match.score || 0;
      const content = match.metadata?.content || '';
      const matchSport = match.metadata?.sport || '';
      
      // Boost score if sport matches
      if (sport && matchSport.toLowerCase() === sport.toLowerCase()) {
        relevanceScore += 0.1;
      }
      
      // Boost score for longer, more detailed content
      if (content.length > 200) {
        relevanceScore += 0.05;
      }
      
      // Boost score if question keywords appear in content
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
    
    // Sort by relevance score
    scoredMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    console.log('🎯 Ranked results:', scoredMatches.map(m => ({
      sport: m.sport,
      score: m.relevanceScore.toFixed(3),
      contentLength: m.content.length
    })));
    
    // Take top 3 results and combine
    return scoredMatches
      .slice(0, 3)
      .map(m => `[${m.sport?.toUpperCase() || 'GENERAL'}] ${m.content}`)
      .join('\n\n---\n\n');
  },

  // Build enhanced prompt with sport context
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
      // Pre-process text to ensure good embeddings
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
      
      return response.data.data[0].embedding;
    } catch (error) {
      console.error('❌ Error getting embedding:', error);
      throw error;
    }
  },

  // Preprocess text to improve embedding quality
  preprocessTextForEmbedding(text) {
    // Remove extra whitespace and normalize
    let processed = text.trim().replace(/\s+/g, ' ');
    
    
    for (const [abbrev, expansion] of Object.entries(expansions)) {
      const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
      processed = processed.replace(regex, `${abbrev} ${expansion}`);
    }
    
    return processed;
  },

  // Utility method to test sport detection and enhancement
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