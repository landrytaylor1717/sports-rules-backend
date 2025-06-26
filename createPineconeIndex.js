import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const indexName = 'sports-rules';

async function createIndex() {
  try {
    const { indexes } = await pinecone.listIndexes();

    if (indexes.includes(indexName)) {
      console.log('✅ Index already exists');
      return;
    }

    await pinecone.createIndex({
      name: indexName,
      dimension: 1536,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
    });

    console.log('✅ Index created successfully');
  } catch (error) {
    console.error('❌ Index creation failed:', error.message);
  }
}

createIndex();
