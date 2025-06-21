// backend/createCollection.js
import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [
    {
      host: 'localhost', // Replace with IP if running remotely
      port: 8108,
      protocol: 'http',
    },
  ],
  apiKey: 'baRRa17!',
  connectionTimeoutSeconds: 2,
});

async function createCollection() {
  const schema = {
    name: 'rules',
    fields: [
      {
        name: 'number',
        type: 'string',
        index: true,
        sort: true,
        store: true,
        facet: false,
      },
      {
        name: 'title',
        type: 'string',
        index: true,
        store: true,
        facet: false,
        prefix: 'true',
      },
      {
        name: 'content',
        type: 'string',
        index: true,
        store: true,
        facet: false,
        prefix: 'true',
      },
      {
        name: 'combined',
        type: 'string',
        index: true,
        store: false,
        facet: false,
      },
      {
        name: 'sport',
        type: 'string',
        index: true,
        store: true,
        facet: true,
        prefix: 'true',
      },
      {
        name: 'path',
        type: 'string',
        index: false,
        store: true,
        facet: false,
      },
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





