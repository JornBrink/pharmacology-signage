/**
 * Haalt recente publicaties op van PubMed + verrijkt met Semantic Scholar
 * (abstract, TL;DR, citatie-aantal)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const AUTHORS = ['van Hasselt JGC', 'van Hasselt JG'];
const MAX_RESULTS = 8;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pubmed.json');

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const reqOpts = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: { 'User-Agent': 'pharmacology-signage/1.0', ...headers },
      timeout: 20000
    };
    https.get(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null))
      .on('timeout', () => resolve(null));
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchSemanticScholar(pmid) {
  // Semantic Scholar free API — returns abstract, TL;DR, citation count
  const url = `https://api.semanticscholar.org/graph/v1/paper/PMID:${pmid}` +
    `?fields=abstract,tldr,citationCount,openAccessPdf`;
  const data = await fetchJson(url);
  if (!data) return {};
  return {
    abstract: data.abstract || '',
    tldr: data.tldr?.text || '',
    citations: data.citationCount ?? null,
    openAccessPdf: data.openAccessPdf?.url || ''
  };
}

async function fetchPubMed() {
  console.log('Fetching PubMed publications...');

  const term = AUTHORS.map(a => `"${a}"[Author]`).join(' OR ');
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
    `?db=pubmed&term=${encodeURIComponent(term)}&retmax=${MAX_RESULTS}&sort=date&retmode=json`;

  const searchData = await fetchJson(searchUrl);
  const ids = searchData?.esearchresult?.idlist || [];

  if (!ids.length) {
    console.log('No publications found.');
    return;
  }
  console.log(`Found IDs: ${ids.join(', ')}`);

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
    `?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryData = await fetchJson(summaryUrl);

  // Fetch Semantic Scholar data for each paper (with small delay to respect rate limits)
  const publications = [];
  for (const id of ids) {
    const pub = summaryData?.result?.[id];
    if (!pub || pub.error) continue;

    console.log(`Enriching PMID ${id} via Semantic Scholar...`);
    const ss = await fetchSemanticScholar(id);
    await sleep(500); // gentle rate limiting

    publications.push({
      id,
      title: (pub.title || '').replace(/\.$/, ''),
      authors: (pub.authors || []).map(a => a.name),
      journal: pub.fulljournalname || pub.source || '',
      year: (pub.pubdate || '').split(' ')[0],
      doi: pub.elocationid || '',
      link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      abstract: ss.abstract,
      tldr: ss.tldr,
      citations: ss.citations,
      openAccessPdf: ss.openAccessPdf
    });
  }

  const output = { updated: new Date().toISOString(), publications };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved ${publications.length} publications to ${OUTPUT_PATH}`);
}

fetchPubMed().catch(err => {
  console.error('PubMed fetch error:', err.message);
  process.exit(0);
});
