import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [
    {
      host: '192.168.4.166', // your Typesense server IP
      port: 8108,
      protocol: 'http',
    },
  ],
  apiKey: 'baRRa17!',
  connectionTimeoutSeconds: 2,
});

async function listDocuments() {
  try {
    const documents = await client.collections('rules').documents().search({
      q: '*',
      query_by: 'combined,title,content',
      per_page: 50,
    });
    console.log('Documents found:', documents.hits.length);
    documents.hits.forEach((hit, index) => {
      console.log(`\nDocument #${index + 1}:`);
      console.log('Number:', hit.document.number);
      console.log('Title:', hit.document.title);
      console.log('Sport:', hit.document.sport);
      console.log('Content snippet:', hit.document.content.substring(0, 100) + '...');
      console.log('Path:', hit.document.path);
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
  }
}

listDocuments();
