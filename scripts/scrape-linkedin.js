/**
 * LinkedIn scraper voor Leiden Pharmacology bedrijfspagina
 * Logt in met credentials uit GitHub Secrets en haalt recente posts op
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COMPANY_URL = 'https://www.linkedin.com/company/pharmacology-leiden/posts/';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'linkedin.json');
const MAX_POSTS = 6;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min = 800, max = 2000) {
  return sleep(min + Math.random() * (max - min));
}

async function scrape() {
  console.log('Starting LinkedIn scrape...');

  if (!process.env.LINKEDIN_EMAIL || !process.env.LINKEDIN_PASSWORD) {
    console.error('Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD secrets.');
    process.exit(0); // Don't fail build, keep existing data
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US'
  });

  const page = await context.newPage();

  try {
    // --- Login ---
    console.log('Logging in...');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay();

    await page.fill('#username', process.env.LINKEDIN_EMAIL);
    await randomDelay(400, 800);
    await page.fill('#password', process.env.LINKEDIN_PASSWORD);
    await randomDelay(600, 1000);
    await page.click('[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await randomDelay(2000, 3000);

    // Check if login succeeded
    const url = page.url();
    if (url.includes('checkpoint') || url.includes('login')) {
      console.warn('Login may have been blocked or requires verification. Keeping existing data.');
      await browser.close();
      process.exit(0);
    }

    // --- Company page ---
    console.log('Opening company page...');
    await page.goto(COMPANY_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Scroll down a bit to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 600));
    await randomDelay(1500, 2500);

    // --- Extract posts ---
    console.log('Extracting posts...');
    const posts = await page.evaluate((maxPosts) => {
      const results = [];

      // Try multiple selectors — LinkedIn changes these regularly
      const containers = [
        ...document.querySelectorAll('[data-urn*="activity"]'),
        ...document.querySelectorAll('.feed-shared-update-v2'),
        ...document.querySelectorAll('[class*="occludable-update"]')
      ];

      // Deduplicate by element
      const seen = new Set();
      const unique = containers.filter(el => {
        if (seen.has(el)) return false;
        seen.add(el);
        return true;
      });

      for (const el of unique) {
        if (results.length >= maxPosts) break;

        // Text content
        const textEl = el.querySelector(
          '[class*="commentary"], [class*="update-components-text"], .feed-shared-text, .feed-shared-update-v2__description'
        );
        const text = textEl ? textEl.innerText.trim() : '';

        // Time
        const timeEl = el.querySelector('time');
        const timeRaw = timeEl
          ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim())
          : '';

        // Actor name
        const actorEl = el.querySelector(
          '[class*="actor__name"], [class*="update-components-actor__name"]'
        );
        const actor = actorEl ? actorEl.innerText.trim() : 'Leiden Pharmacology';

        // Image
        const imgEl = el.querySelector(
          '[class*="feed-shared-image"] img, [class*="update-components-image"] img'
        );
        const img = imgEl ? imgEl.src : '';

        // Link to post
        const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/feed/update/"]');
        const link = linkEl ? linkEl.href.split('?')[0] : '';

        if (text.length > 20) {
          results.push({ text, timeRaw, actor, img: img.startsWith('data:') ? '' : img, link });
        }
      }

      return results;
    }, MAX_POSTS);

    console.log(`Found ${posts.length} posts.`);

    const output = {
      updated: new Date().toISOString(),
      source: COMPANY_URL,
      posts
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log('LinkedIn data saved to', OUTPUT_PATH);

  } catch (err) {
    console.error('Scrape error:', err.message);
    // Keep existing data file — don't overwrite with empty
  } finally {
    await browser.close();
  }
}

scrape();
