const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class JohnsAndCoAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'Johns&Co';
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const priceMin = config.minPrice !== undefined ? config.minPrice : 2000;
    const priceMax = config.maxPrice !== undefined ? config.maxPrice : 2700;

    const searchUrls = [
      `https://www.johnsand.co/rent?location=E14&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`,
      `https://www.johnsand.co/rent?location=Canary%20Wharf&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`,
      `https://www.johnsand.co/rent?location=South%20Quay&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`
    ];

    const locs = (config.locations || []).map(l => l.toLowerCase());
    if (locs.some(l => l.includes('custom house') || l.includes('royal victoria') || l.includes('e16'))) {
      searchUrls.push(`https://www.johnsand.co/rent?location=E16&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`);
    }
    if (locs.some(l => l.includes('greenwich') || l.includes('se10'))) {
      searchUrls.push(`https://www.johnsand.co/rent?location=SE10&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`);
    }
    if (locs.some(l => l.includes('woolwich') || l.includes('se18'))) {
      searchUrls.push(`https://www.johnsand.co/rent?location=SE18&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`);
    }

    const allLinks = new Set();
    try {
      for (const url of searchUrls) {
        console.log(`Navigating to ${this.platformName} search URL: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(2000);

        const links = await this.page.$$eval('a', els =>
          els.map(a => a.href).filter(h => h.includes('/properties/') && h.match(/-(\d+)$/))
        );
        links.forEach(l => allLinks.add(l));
      }
      const uniqueLinks = [...allLinks];
      console.log(`Found ${uniqueLinks.length} unique property links across E14, Canary Wharf & South Quay on ${this.platformName}.`);

      for (const link of uniqueLinks) {
        const idMatch = link.match(/-(\d+)$/);
        const id = idMatch ? idMatch[1] : link;

        if (isSeen(id, this.platformName)) {
          console.log(`[${this.platformName}] Property ${id} already seen. Skipping.`);
          continue;
        }

        const match = await this.processListing({ id, link });
        if (match) {
          results.push(match);
          markAsSeen(id, this.platformName);
        }
      }
    } catch (err) {
      console.error(`Error scraping ${this.platformName}:`, err.message);
    }

    return results;
  }

  async processListing({ id, link }) {
    console.log(`[${this.platformName}] Processing listing: ${link}`);
    try {
      await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(2000);

      const pageData = await this.page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.innerText || '';
        return { bodyText, title, h1 };
      });

      const { bodyText, title, h1 } = pageData;

      let propertyName = h1 || title.split('|')[0].trim() || 'Unknown';

      // Extract price
      let price = null;
      const monthlyMatch = bodyText.match(/£([\d,]+)\s*(?:pcm|\/month|per month|monthly)/i);
      if (monthlyMatch) {
        price = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      } else {
        const weeklyMatch = bodyText.match(/£([\d,]+)\s*(?:pcw|p\/w|pw|per week|weekly)/i);
        if (weeklyMatch) {
          const weekly = parseInt(weeklyMatch[1].replace(/,/g, ''), 10);
          price = Math.round((weekly * 52) / 12);
        }
      }

      if (!price) {
        const priceMatch = bodyText.match(/£([\d,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }

      if (price && price > config.maxPrice) {
        const reason = `Price £${price} above max £${config.maxPrice}`;
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }

      let sqm = extractSqmFromText(bodyText);

      // Fallback: Check floorplan image OCR if not found in text
      if (!sqm) {
        try {
          const imageUrls = await this.page.$$eval('img, a', els => {
            const urls = [];
            for (const el of els) {
              let rawUrl = el.src || el.href || '';
              if (!rawUrl && el.srcset) {
                rawUrl = el.srcset.split(' ')[0];
              }
              if (!rawUrl) continue;
              const nextMatch = rawUrl.match(/[?&]url=([^&]+)/);
              const decodedUrl = nextMatch ? decodeURIComponent(nextMatch[1]) : rawUrl;

              const isFloorplanName = /floorplan|floor-plan|floor_plan|l?fp\d*[\._-]/i.test(decodedUrl);
              const altText = (el.alt || el.title || el.innerText || '').toLowerCase();
              const isFloorplanAlt = /floorplan|floor plan|layout/i.test(altText);
              const w = parseInt(el.getAttribute('width') || '0', 10);
              const h = parseInt(el.getAttribute('height') || '0', 10);
              const isFloorplanDim = (h > 1500 && w > 1000 && h > w);

              if (isFloorplanName || isFloorplanAlt || isFloorplanDim) {
                urls.push(decodedUrl);
              }
            }
            return urls;
          });
          if (imageUrls.length > 0) {
            console.log(`[${this.platformName}] Running OCR on floorplan image: ${imageUrls[0]}...`);
            const text = await extractTextFromImage(imageUrls[0]);
            sqm = extractSqmFromText(text);
          }
        } catch (ocrErr) {
          console.error(`[${this.platformName}] OCR Error:`, ocrErr.message);
        }
      }

      if (sqm && sqm < config.minSqm) {
        const reason = `Size ${sqm} sqm below min ${config.minSqm}`;
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }

      let letAvailableDate = 'Ask agent';
      const availMatch = bodyText.match(/(?:Available|Let Available|Available from)[:\s]+([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i);
      if (availMatch) {
        letAvailableDate = availMatch[1].trim();
      }
      return {
        platform: this.platformName,
        id: id,
        price: price || 0,
        sqm: sqm || 0,
        location: 'Canary Wharf (E14)',
        propertyName: propertyName,
        agent: 'JOHNS&CO',
        url: link,
        listingUpdate: new Date().toISOString().split('T')[0],
        listingStatus: 'Available',
        letAvailableDate: letAvailableDate
      };
    } catch (err) {
      console.error(`[${this.platformName}] Error processing ${id}:`, err.message);
      return null;
    }
  }
}

module.exports = JohnsAndCoAdapter;
