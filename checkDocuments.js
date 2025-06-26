import dotenv from 'dotenv';
import Typesense from 'typesense';

dotenv.config();

const client = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST,
      port: parseInt(process.env.TYPESENSE_PORT, 10),
      protocol: process.env.TYPESENSE_PROTOCOL,
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 5,
});

async function listDocuments() {
  try {
    console.log('🔧 Checking existing collections...');
    const collections = await client.collections().retrieve();
    console.log('✅ Collections:', collections.map(c => c.name));

    const documents = await client.collections('rules').documents().search({
      q: '*',
      query_by: 'combined,title,content',
      per_page: 50,
    });

    console.log(`✅ ${documents.hits?.length || 0} documents found.`);

    documents.hits?.forEach((hit, index) => {
      const doc = hit.document;
      console.log(`\n📄 Document #${index + 1}:`);
      console.log(`Number: ${doc.number}`);
      console.log(`Title: ${doc.title}`);
      console.log(`Sport: ${doc.sport}`);
      console.log(`Content snippet: ${(doc.content || '').substring(0, 100)}...`);
      console.log(`Path: ${doc.path}`);
    });
  } catch (error) {
    console.error('❌ Error fetching documents:', error?.message || error);
  }
}

listDocuments();
