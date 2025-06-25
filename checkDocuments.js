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
  connectionTimeoutSeconds: 2,
});

async function listDocuments() {
  try {
    const documents = await client.collections('rules').documents().search({
      q: '*',
      query_by: 'combined,title,content',
      per_page: 50,
    });
    console.log(`✅ ${documents.hits.length} documents found.`);
    documents.hits.forEach((hit, index) => {
      console.log(`\n📄 Document #${index + 1}:`);
      console.log('Number:', hit.document.number);
      console.log('Title:', hit.document.title);
      console.log('Sport:', hit.document.sport);
      console.log('Content snippet:', (hit.document.content || '').substring(0, 100) + '...');
      console.log('Path:', hit.document.path);
    });
  } catch (error) {
    console.error('❌ Error fetching documents:', error);
  }
}

listDocuments();
