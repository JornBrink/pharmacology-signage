/**
 * Haalt recente publicaties op van PubMed voor opgegeven auteurs
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const AUTHORS = ['van Hasselt JGC', 'van Hasselt JG'];
const MAX_RESULTS = 8;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pubmed.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Request timeout')));
  });
}

async function fetchPubMed() {
  console.log('Fetching PubMed publications...');

  const term = AUTHORS.map(a => `"${a}"[Author]`).join(' OR ');

  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
    `?db=pubmed&term=${encodeURIComponent(term)}&retmax=${MAX_RESULTS}&sort=date&retmode=json`;

  const searchData = await fetchJson(searchUrl);
  const ids = searchData.esearchresult?.idlist || [];

  if (!ids.length) {
    console.log('No publications found.');
    return;
  }

  console.log(`Found IDs: ${ids.join(', ')}`);

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
    `?db=pubmed&id=${ids.join(',')}&retmode=json`;

  const summaryData = await fetchJson(summaryUrl);

  const publications = ids.map(id => {
    const pub = summaryData.result?.[id];
    if (!pub || pub.error) return null;
    return {
      id,
      title: (pub.title || '').replace(/\.$/, ''),
      authors: (pub.authors || []).map(a => a.name),
      journal: pub.fulljournalname || pub.source || '',
      year: (pub.pubdate || '').split(' ')[0],
      doi: pub.elocationid || '',
      link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
    };
  }).filter(Boolean);

  const output = {
    updated: new Date().toISOString(),
    publications
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved ${publications.length} publications to ${OUTPUT_PATH}`);
}

fetchPubMed().catch(err => {
  console.error('PubMed fetch error:', err.message);
  process.exit(0); // Don't fail the build
});
