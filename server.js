import cors from 'cors';
import express from 'express';
import Typesense from 'typesense';

const app = express();
app.use(cors());

const client = new Typesense.Client({
  nodes: [
    {
      host: 'localhost',
      port: 8108,
      protocol: 'http',
    },
  ],
  apiKey: 'baRRa17!',
  connectionTimeoutSeconds: 2,
});

app.get('/search', async (req, res) => {
  const query = req.query.q?.trim() || '';
  const sportFilter = req.query.sport?.trim() || '';

  if (!query) {
    return res.status(400).json({ error: 'Query param `q` is required' });
  }

  try {
    const searchParameters = {
      q: query,
      query_by: 'content, title, combined',
      query_by_weights: '4,3,2',
      per_page: 20,
      num_typos: 2,
      filter_by: sportFilter ? `sport:=${sportFilter}` : undefined,
      sort_by: '_text_match:desc',
    };

    const searchResults = await client.collections('rules').documents().search(searchParameters);

    const hits = searchResults.hits.map(({ document }) => ({
      number: document.number,
      title: document.title,
      content: document.content,
      sport: document.sport,
      path: document.path,
    }));

    res.json({ hits });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://192.168.4.166:${PORT}`);
});





