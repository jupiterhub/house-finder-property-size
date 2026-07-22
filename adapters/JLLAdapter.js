const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class JLLAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'JLL';
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const priceMin = config.minPrice !== undefined ? config.minPrice : 1900;
    const priceMax = config.maxPrice !== undefined ? config.maxPrice : 2700;

    const searchUrls = [
      `https://residential.jll.co.uk/search?tenureType=rent&placeId=ChIJuZV87v-n2EcRQWuoaOCPFzg&placeName=London%20E14%2C%20UK&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&latEnc=51.50686602787108&lngEnc=-0.015439010925319078&radius=3.123&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`,
      `https://residential.jll.co.uk/search?tenureType=rent&placeName=South%20Quay%2C%20London&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&radius=3.0&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`
    ];

    const locs = (config.locations || []).map(l => l.toLowerCase());
    if (locs.some(l => l.includes("king's cross") || l.includes('n1c') || l.includes('n1'))) {
      searchUrls.push(`https://residential.jll.co.uk/search?tenureType=rent&placeName=King%27s%20Cross%2C%20London&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&radius=3.0&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`);
    }
    if (locs.some(l => l.includes('city road') || l.includes('ec1v') || l.includes('old street') || l.includes('farringdon'))) {
      searchUrls.push(`https://residential.jll.co.uk/search?tenureType=rent&placeName=Old%20Street%2C%20London&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&radius=3.0&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`);
    }
    if (locs.some(l => l.includes('canada water') || l.includes('se16'))) {
      searchUrls.push(`https://residential.jll.co.uk/search?tenureType=rent&placeName=Canada%20Water%2C%20London&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&radius=3.0&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`);
    }
    if (locs.some(l => l.includes('wapping') || l.includes('london dock') || l.includes('e1w'))) {
      searchUrls.push(`https://residential.jll.co.uk/search?tenureType=rent&placeName=Wapping%2C%20London&priceMin=${priceMin}&priceMax=${priceMax}&currencyType=GBP&radius=3.0&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`);
    }

    const allLinks = new Set();
    try {
      for (const url of searchUrls) {
        console.log(`Navigating to ${this.platformName} search URL: ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(2000);

        const links = await this.page.$$eval('a', els =>
          els.map(a => a.href).filter(h => h.includes('/rent-') && h.match(/-p\d+/i))
        );
        links.forEach(l => allLinks.add(l));

        if (links.length === 0) {
          console.log(`[${this.platformName}] Playwright found 0 links on search URL. Using SSR fetch fallback...`);
          try {
            const res = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
              }
            });
            const html = await res.text();
            const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (ndMatch) {
              const nextJson = JSON.parse(ndMatch[1]);
              const searchResults = nextJson?.props?.pageProps?.properties || nextJson?.props?.pageProps?.initialState?.search?.results || [];
              for (const item of searchResults) {
                if (item.pageUrl) {
                  const fullUrl = item.pageUrl.startsWith('http') ? item.pageUrl : `https://residential.jll.co.uk${item.pageUrl}`;
                  allLinks.add(fullUrl);
                }
              }
            }
          } catch (fetchErr) {
            console.error(`[${this.platformName}] SSR fetch error:`, fetchErr.message);
          }
        }
      }

      const uniqueLinks = [...allLinks];

      console.log(`Found ${uniqueLinks.length} unique property links on ${this.platformName}.`);

      for (const link of uniqueLinks) {
        const idMatch = link.match(/-p(\d+)/i);
        const id = idMatch ? `P${idMatch[1]}` : link;

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
        const nextScript = document.querySelector('script#__NEXT_DATA__');
        let nextJson = null;
        if (nextScript) {
          try {
            nextJson = JSON.parse(nextScript.textContent);
          } catch (e) {}
        }

        const bodyText = document.body.innerText || '';
        return {
          nextJson,
          bodyText,
          title: document.title
        };
      });

      if (!pageData.nextJson || pageData.title.includes('Access Denied')) {
        const res = await fetch(link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });
        const html = await res.text();
        const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (ndMatch) {
          try {
            pageData.nextJson = JSON.parse(ndMatch[1]);
          } catch (e) {}
        }
        pageData.bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }

      const prop = pageData.nextJson?.props?.pageProps?.property || {};
      const bodyText = pageData.bodyText;

      // Extract property name
      let propertyName = prop.title || prop.addressLine1 || pageData.title || 'Unknown';
      propertyName = propertyName.split(' - ')[0].trim();

      // Extract price (monthly PCM)
      let price = null;
      const monthlyMatch = bodyText.match(/£([\d,]+)\s*(?:\/month|pcm|per month|monthly)/i);
      if (monthlyMatch) {
        price = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      } else {
        const weeklyMatch = bodyText.match(/£([\d,]+)\s*(?:p\/w|pw|per week|weekly)/i);
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

      if (price && config.minPrice && price < config.minPrice) {
        const reason = `Price £${price} below min £${config.minPrice}`;
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }

      if (price && config.maxPrice && price > config.maxPrice) {
        const reason = `Price £${price} above max £${config.maxPrice}`;
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }

      // Extract sqm from text
      let combinedTextForSqm = bodyText;
      if (prop.description) combinedTextForSqm += ' ' + prop.description;
      if (Array.isArray(prop.amenities)) {
        combinedTextForSqm += ' ' + prop.amenities.join(' ');
      }
      let sqm = extractSqmFromText(combinedTextForSqm);

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
        agent: 'JLL',
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

module.exports = JLLAdapter;
