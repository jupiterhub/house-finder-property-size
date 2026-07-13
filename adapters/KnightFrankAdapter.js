const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class KnightFrankAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'KnightFrank';
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const priceMin = config.minPrice !== undefined ? config.minPrice : 2000;
    const priceMax = config.maxPrice !== undefined ? config.maxPrice : 2700;

    const searchUrls = [
      `https://www.knightfrank.co.uk/properties/residential/to-let/uk-greater-london-canary-wharf-e14/all-types/all-beds;pricemin=${priceMin};pricemax=${priceMax};availability=available`,
      `https://www.knightfrank.co.uk/properties/residential/to-let/uk-greater-london-south-quay-e14/all-types/all-beds;pricemin=${priceMin};pricemax=${priceMax};availability=available`,
      `https://www.knightfrank.co.uk/properties/residential/to-let/uk-greater-london-blackwall-e14/all-types/all-beds;pricemin=${priceMin};pricemax=${priceMax};availability=available`,
      `https://www.knightfrank.co.uk/properties/residential/to-let/uk-greater-london-e14/all-types/all-beds;pricemin=${priceMin};pricemax=${priceMax};availability=available`
    ];

    const allLinks = new Set();
    try {
      for (const url of searchUrls) {
        console.log(`Navigating to ${this.platformName} search URL: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForSelector('a[href*="/properties/residential/to-let/"]', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        const links = await this.page.$$eval('a', els =>
          els.map(a => a.href).filter(h => h.includes('/properties/residential/to-let/') && !h.includes('/all-types/') && /\/([a-z0-9]{6,})/i.test(h))
        );
        links.forEach(l => allLinks.add(l));
      }
      const uniqueLinks = [...allLinks];
      console.log(`Found ${uniqueLinks.length} unique property links across Canary Wharf, South Quay & E14 on ${this.platformName}.`);

      for (const link of uniqueLinks) {
        const idMatch = link.match(/\/([a-z0-9]{6,})(?:\?|$)/i);
        const id = idMatch ? idMatch[1].toUpperCase() : link;

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
      await this.page.waitForTimeout(3500);

      const pageData = await this.page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.innerText || '';
        return { bodyText, title, h1 };
      });

      const { bodyText, title, h1 } = pageData;

      let propertyName = h1 || title.split('|')[0].trim() || 'Unknown';

      // Extract price (look for monthly first e.g. £2,275 Monthly)
      let price = null;
      const monthlyMatch = bodyText.match(/£([\d,]+)\s*(?:Monthly|pcm|\/month|per month)/i);
      if (monthlyMatch) {
        price = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      } else {
        const weeklyMatch = bodyText.match(/£([\d,]+)\s*(?:Weekly|p\/w|pw|per week)/i);
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
          const imageUrls = await this.page.$$eval('img, a', els =>
            els.map(el => el.src || el.href).filter(url => url && (/floorplan|floor-plan|floor_plan/i.test(url) || /floorplan/i.test(el.alt || el.title || el.innerText || '')))
          );
          if (imageUrls.length > 0) {
            console.log(`[${this.platformName}] Running OCR on floorplan image...`);
            const text = await extractTextFromImage(imageUrls[0]);
            sqm = extractSqmFromText(text);
          }
        } catch (ocrErr) {}
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
        agent: 'Knight Frank',
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

module.exports = KnightFrankAdapter;
