import dotenv from 'dotenv';
import Typesense from 'typesense';

dotenv.config();
console.log("API KEY BEING USED:", process.env.TYPESENSE_API_KEY);

const client = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST,
      port: parseInt(process.env.TYPESENSE_PORT || '443', 10),
      protocol: process.env.TYPESENSE_PROTOCOL || 'https',
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 2,
});

async function createCollection() {
  const schema = {
    name: 'rules',
    fields: [
      { name: 'number', type: 'string', index: true, sort: true, store: true },
      { name: 'title', type: 'string', index: true, store: true, facet: true, optional: true },
      { name: 'content', type: 'text', index: true, store: true },
      { name: 'combined', type: 'string', index: true, store: false, optional: true },
      { name: 'sport', type: 'string', index: true, store: true, facet: true },
      { name: 'path', type: 'string', index: false, store: true, optional: true },
    ],
    default_sorting_field: 'number',
    token_separators: ['-', '.', ':', '(', ')', ' '],
  };

  try {
    await client.collections('rules').delete();
    console.log('🧹 Existing collection deleted.');
  } catch (e) {
    console.log('ℹ️ No existing collection to delete.');
  }

  try {
    const result = await client.collections().create(schema);
    console.log('✅ Collection created:', result);
  } catch (error) {
    console.error('❌ Error creating collection:', error);
  }
}

createCollection();



