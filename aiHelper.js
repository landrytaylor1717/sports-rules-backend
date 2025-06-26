import axios from 'axios';

export default {
  async answerQuestion(question, pineconeIndex) {
    const embedding = await this.getEmbedding(question);

    const queryResponse = await pineconeIndex.query({
      vector: embedding,
      topK: 3,
      includeMetadata: true,
    });

    const topChunks = queryResponse.matches
      .map((m) => m.metadata?.content || '')
      .join('\n\n');

    const prompt = `You are a sports rule expert. Using the following rulebook content, answer the user's question clearly and accurately. Do not invent information not found in the rules.

Rulebook Content:
${topChunks}

Question:
${question}

Answer:`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    const aiAnswer = response.data.choices[0].message.content.trim();
    return { answer: aiAnswer };
  },

  async getEmbedding(text) {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: text,
        model: 'text-embedding-ada-002',
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    return response.data.data[0].embedding;
  },
};
