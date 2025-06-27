import dotenv from 'dotenv';
import Typesense from 'typesense';

dotenv.config();

const client = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST,
      port: parseInt(process.env.TYPESENSE_PORT || '443', 10),
      protocol: process.env.TYPESENSE_PROTOCOL || 'https',
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 5,
});

async function listCollections() {
  try {
    console.log('🔧 Connecting to Typesense...');
    const collections = await client.collections().retrieve();
    console.log('✅ Collections found:', collections.map(c => c.name));
    console.log('Full details:', collections);
  } catch (error) {
    console.error('❌ Error fetching collections:', error?.message || error);
  }
}

listCollections();
