const { isSeen, markAsSeen, markAsIgnored, updateLocationIfUnknown } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class RightmoveAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'Rightmove';
  }

  async acceptCookies() {
    try {
      const acceptBtn = await this.page.waitForSelector('#onetrust-accept-btn-handler, button:has-text("Allow all cookies"), button:has-text("Accept all")', { timeout: 3000 });
      if (acceptBtn) {
        await acceptBtn.click();
        console.log('Accepted Rightmove cookies.');
        await this.page.waitForTimeout(1000);
      }
    } catch(e) {}
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const LOCATION_IDENTIFIERS = {
      "canary wharf": "STATION^1724",
      "wood wharf": "STATION^1724",
      "south quay": "STATION^8432",
      "south quay / canary wharf south": "STATION^8432",
      "canary wharf south": "STATION^8432",
      "south quay station": "STATION^8432",
      "crossharbour": "STATION^2504",
      "crossharbour station": "STATION^2504",
      "custom house / royal victoria docks": "STATION^2540",
      "custom house / royal victoria": "STATION^2540",
      "custom house / royal dock": "STATION^2540",
      "custom house / royal docks": "STATION^2540",
      "custom house": "STATION^2540",
      "royal victoria": "STATION^7835",
      "royal victoria docks": "STATION^7835",
      "greenwich peninsula": "STATION^6719",
      "north greenwich": "STATION^6719",
      "woolwich": "REGION^70391",
      "woolwich (royal arsenal)": "STATION^15846",
      "royal arsenal, woolwich": "STATION^15846",
      "royal arsenal": "STATION^15846",
      "paddington": "STATION^6965",
      "moorgate": "STATION^6332",
      "bloomsbury (russell square)": "STATION^7877",
      "farringdon / clerkenwell": "STATION^3431",
      "king's cross": "STATION^5162",
      "blackfriars": "STATION^1040",
      "ealing broadway": "STATION^3023",
      "london bridge": "STATION^5792",
      "stratford": "STATION^8813",
      "angel": "STATION^245",
      "highbury & islington": "STATION^4583",
      "openrent (london)": "https://www.rightmove.co.uk/estate-agents/agent/OpenRent/London-96668.html?transactionType=lettings"
    };

    const locationsToScrape = config.locations || [];
    let isFirstLocation = true;
    for (const locationName of locationsToScrape) {
      if (!isFirstLocation) {
        // Human-like pause when switching between search locations (1.5s - 3s)
        await this.page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
      }
      isFirstLocation = false;
      const key = locationName.toLowerCase().trim();
      const identifier = LOCATION_IDENTIFIERS[key];
      
      if (!identifier) {
        console.warn(`Warning: Location "${locationName}" is not mapped to a Rightmove identifier/URL. Skipping.`);
        continue;
      }

      for (const pageIndex of [0, 24]) {
        if (pageIndex > 0) {
          // Human-like jitter before navigating to the next search page index (1s - 2.5s)
          await this.page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
        }
        let url;
        if (identifier.startsWith('http')) {
          url = pageIndex === 0 ? identifier : identifier + (identifier.includes('?') ? '&' : '?') + `index=${pageIndex}`;
        } else {
          const encodedId = encodeURIComponent(identifier);
          const minP = config.minPrice || 1900;
          const radiusParam = identifier.startsWith('STATION^') ? '&radius=0.5' : '';
          url = `https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=${encodedId}${radiusParam}&_includeLetAgreed=false&maxBedrooms=2&index=${pageIndex}&sortType=6&channel=RENT&transactionType=LETTING&minPrice=${minP}&maxPrice=${config.maxPrice}`;
        }
        
        console.log(`Navigating to search URL: ${url} (${locationName}, index=${pageIndex})`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.acceptCookies();
        await this.page.waitForSelector('.propertyCard-link', { timeout: 10000 }).catch(() => {});

        // Extract search page dates and listings from __NEXT_DATA__ if available
        const { searchPageDates, nextListings } = await this.page.evaluate(() => {
          const map = {};
          const list = [];
          try {
            const script = document.querySelector('script#__NEXT_DATA__');
            if (script) {
              const data = JSON.parse(script.textContent);
              const props = data?.props?.pageProps?.searchResults?.properties || [];
              for (const p of props) {
                if (p && p.id) {
                  map[String(p.id)] = {
                    firstVisibleDate: p.firstVisibleDate || null,
                    listingUpdateDate: p?.listingUpdate?.listingUpdateDate || p.firstVisibleDate || null,
                    addedOrReduced: p.addedOrReduced || null,
                    letAvailableDate: p.letAvailableDate || null,
                    displayAddress: p.displayAddress || null
                  };
                  if (p.price?.amount) {
                    list.push({
                      id: String(p.id),
                      link: `https://www.rightmove.co.uk/properties/${p.id}`,
                      price: p.price.amount
                    });
                  }
                }
              }
            }
          } catch(e) {}
          return { searchPageDates: map, nextListings: list };
        }).catch(() => ({ searchPageDates: {}, nextListings: [] }));

        // Extract links and prices from DOM fallback
        let domListings = await this.page.$$eval('div', els => {
            return Array.from(document.querySelectorAll('div')).map(div => {
                const a = div.querySelector('a[href*="/properties/"]');
                if (!a) return null;
                const text = div.innerText;
                const priceMatch = text.match(/£[\d,]+/);
                if (priceMatch && a.href.includes('properties/')) {
                    if (div.innerText.length < 2000) {
                        const link = a.href;
                        const idMatch = link.match(/properties\/(\d+)/);
                        if (!idMatch) return null;
                        const priceText = priceMatch[0].replace(/£|,/g, '').trim();
                        const price = parseInt(priceText, 10);
                        return { id: idMatch[1], link, price, divLength: div.innerText.length };
                    }
                }
                return null;
            }).filter(Boolean).sort((a,b) => a.divLength - b.divLength);
        });

        // Merge and deduplicate
        const seenId = new Set();
        const listings = [];
        for (const item of [...nextListings, ...domListings]) {
            if (!seenId.has(item.id)) {
                seenId.add(item.id);
                listings.push(item);
            }
        }

        console.log(`Found ${listings.length} listings on page index=${pageIndex}.`);

        for (const listing of listings) {
          if (isSeen(listing.id, this.platformName)) {
            console.log(`Skipping already seen property: ${listing.id}`);
            continue;
          }

          if (listing.price > config.maxPrice) {
            console.log(`Skipping property ${listing.id} (Price ${listing.price} exceeds max ${config.maxPrice})`);
            markAsIgnored(listing.id, this.platformName, `Price £${listing.price} exceeds max £${config.maxPrice}`);
            continue;
          }

          if (config.minPrice && listing.price < config.minPrice) {
            console.log(`Skipping property ${listing.id} (Price £${listing.price} below min £${config.minPrice})`);
            markAsIgnored(listing.id, this.platformName, `Price £${listing.price} below min £${config.minPrice}`);
            continue;
          }

          // Human-like jitter before visiting individual property floorplan page (1s - 2s)
          await this.page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
          const match = await this.processListing(listing, locationName, searchPageDates[listing.id] || {});
          if (match) {
            markAsSeen(listing.id, this.platformName);
            results.push(match);
          }
        }
      }
    }
    
    return results;
  }

  async processListing(listing, locationName, searchDates = {}) {
    const floorplanUrl = `https://www.rightmove.co.uk/properties/${listing.id}#/floorplan`;
    console.log(`Processing listing: ${floorplanUrl}`);
    
    try {
      await this.page.goto(floorplanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // 1. Try to extract from PAGE_MODEL first
      const pageModelText = await this.page.evaluate(() => {
        const script = Array.from(document.querySelectorAll('script')).find(s => s.textContent && s.textContent.includes('PAGE_MODEL'));
        return script ? script.textContent : null;
      });

      let sqm = null;

      if (pageModelText) {
        sqm = extractSqmFromText(pageModelText); // A bit brute-force, but fast.
      }

      // 2. If not in text, look for floorplan image
      if (!sqm) {
        const imageUrls = await this.page.$$eval('img', imgs => 
          imgs.map(img => img.src).filter(src => src.includes('dir/crop') || src.includes('floorplan'))
        );

        if (imageUrls.length > 0) {
          console.log(`Found floorplan image, running OCR...`);
          const targetImage = imageUrls[0];
          
          // Scale image using Playwright for better OCR
          const imageBuffer = await this.page.evaluate(async (url) => {
              return new Promise((resolve) => {
                  const img = new Image();
                  img.crossOrigin = "Anonymous";
                  img.onload = () => {
                      if (img.width < 10 || img.height < 10) {
                          console.log("Image too small to scale!");
                          resolve(null);
                          return;
                      }
                      const canvas = document.createElement('canvas');
                      canvas.width = img.width * 3;
                      canvas.height = img.height * 3;
                      const ctx = canvas.getContext('2d');
                      ctx.scale(3, 3);
                      ctx.drawImage(img, 0, 0);
                      resolve(canvas.toDataURL('image/png'));
                  };
                  img.onerror = () => resolve(null);
                  img.src = url;
              });
          }, targetImage);

          const text = await extractTextFromImage(imageBuffer || targetImage);
          sqm = extractSqmFromText(text);
        } else {
          console.log(`No floorplan image found for ${listing.id}. Continuing with size check.`);
        }
      }

      // Extract agent / marketed by
      let agentName = await this.page.evaluate(() => {
        // 1. Check meta og:description first (e.g. "Marketed by OpenRent, London")
        const metaDesc = document.querySelector('meta[property="og:description"]');
        if (metaDesc && metaDesc.content) {
          const mMatch = metaDesc.content.match(/Marketed by\s+([^<'""\.,]+(?:,\s*[^<'""\.,]+)?)/i);
          if (mMatch && mMatch[1]) {
            const val = mMatch[1].trim();
            if (val.toLowerCase().includes('openrent')) return 'OpenRent, London';
            return val;
          }
        }

        // 2. Check agent links (including img alt attributes if anchor has an image logo)
        const agentLinks = Array.from(document.querySelectorAll('a[href*="/estate-agents/agent/"], a[href*="BRANCH^"], a[href*="/property-to-rent/find/"]'));
        for (const link of agentLinks) {
          const txt = (link.textContent || '').trim() || (link.querySelector('img') ? (link.querySelector('img').alt || '').trim() : '');
          if (txt && !txt.toLowerCase().includes('more properties') && !txt.toLowerCase().includes('valuation') && !txt.toLowerCase().includes('find estate') && !txt.toLowerCase().includes('find an agent')) {
            if (txt.toLowerCase().includes('openrent')) return 'OpenRent, London';
            return txt;
          }
        }

        // 3. Check agent profile URL
        for (const link of agentLinks) {
          const match = link.href.match(/\/estate-agents\/agent\/([^\/]+)\//);
          if (match && match[1]) {
            const decoded = decodeURIComponent(match[1]).replace(/-/g, ' ');
            if (decoded.toLowerCase() === 'openrent' || decoded.toLowerCase().includes('openrent')) return 'OpenRent, London';
            return decoded;
          }
        }

        // 4. Check adInfo
        if (window.adInfo && Array.isArray(window.adInfo)) {
          const cIdObj = window.adInfo.find(item => item && item.key === 'C_ID');
          if (cIdObj && cIdObj.value && cIdObj.value[0]) {
            return cIdObj.value[0];
          }
        }
        return 'Unknown';
      }).catch(() => 'Unknown');

      // Fallback if locationName is OpenRent or link implies OpenRent
      if ((!agentName || agentName === 'Unknown') && (locationName.toLowerCase().includes('openrent') || listing.link.toLowerCase().includes('openrent'))) {
        agentName = 'OpenRent, London';
      }

      // Extract letAvailableDate, listingStatus, and listingUpdate from detail page
      const detailMetadata = await this.page.evaluate(() => {
        let letAvailableDate = 'Unknown';
        let listingStatus = 'Unknown';
        let listingUpdate = 'Unknown';
        let propertyName = 'Unknown';

        try {
          let pd = window.__PAGE_MODEL?.propertyData || window.PAGE_MODEL?.propertyData || window.__NEXT_DATA__?.props?.pageProps?.propertyData;
          let analyticsAdded = null;
          if (window.__PAGE_MODEL && typeof window.__PAGE_MODEL.data === 'string') {
            const arr = JSON.parse(window.__PAGE_MODEL.data);
            function resolve(val, visited = new Set()) {
              if (typeof val === 'number' && arr[val] !== undefined) {
                if (visited.has(val)) return null;
                visited.add(val);
                return resolve(arr[val], visited);
              }
              if (Array.isArray(val)) return val.map(x => resolve(x, new Set(visited)));
              if (val && typeof val === 'object') {
                const res = {};
                for (const [k, v] of Object.entries(val)) res[k] = resolve(v, new Set(visited));
                return res;
              }
              return val;
            }
            const root = resolve(arr[0]);
            if (root?.propertyData) pd = root.propertyData;
            
            if (root?.analyticsInfo?.analyticsProperty?.added) {
              const addedStr = String(root.analyticsInfo.analyticsProperty.added);
              if (/^\d{8}$/.test(addedStr)) {
                analyticsAdded = `${addedStr.slice(0,4)}-${addedStr.slice(4,6)}-${addedStr.slice(6,8)}`;
              } else if (/^\d{4}-\d{2}-\d{2}/.test(addedStr)) {
                analyticsAdded = addedStr.slice(0, 10);
              }
            }
          }

          if (!pd) {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
              if (s.textContent && (s.textContent.includes('PAGE_MODEL') || s.textContent.includes('propertyData'))) {
                const match = s.textContent.match(/(?:window\.)?__?PAGE_MODEL\s*=\s*(\{.*?\})\s*(?:;|\n|$)/) ||
                              s.textContent.match(/\"propertyData\"\s*:\s*(\{.*?\})\s*(?:,|\})/);
                if (match) {
                  try {
                    const data = JSON.parse(match[1]);
                    pd = data.propertyData || data;
                    if (pd) break;
                  } catch (err) {}
                }
              }
            }
          }

          if (pd && typeof pd === 'object') {
            if (pd.lettings?.letAvailableDate) {
              letAvailableDate = String(pd.lettings.letAvailableDate).trim();
            } else if (pd.letAvailableDate) {
              letAvailableDate = String(pd.letAvailableDate).trim();
            }

            if (pd.listingHistory?.listingUpdateReason) {
              listingStatus = String(pd.listingHistory.listingUpdateReason).trim();
            } else if (typeof pd.listingUpdate === 'string') {
              listingStatus = pd.listingUpdate.trim();
            } else if (pd.addedOrReduced) {
              listingStatus = String(pd.addedOrReduced).trim();
            }

            if (pd.firstVisibleDate) {
              listingUpdate = String(pd.firstVisibleDate).split('T')[0];
            } else if (pd.listingUpdate?.listingUpdateDate) {
              listingUpdate = String(pd.listingUpdate.listingUpdateDate).split('T')[0];
            } else if (analyticsAdded) {
              listingUpdate = analyticsAdded;
            }

            if (pd.address?.displayAddress) {
              propertyName = String(pd.address.displayAddress).trim();
            } else if (pd.location?.displayAddress) {
              propertyName = String(pd.location.displayAddress).trim();
            } else if (pd.displayAddress) {
              propertyName = String(pd.displayAddress).trim();
            }
          }
        } catch (e) {}

        const text = document.body ? document.body.innerText : "";
        if (letAvailableDate === 'Unknown' || !letAvailableDate) {
          const m = text.match(/Let\s+available\s+date:\s*([^\n]+)/i);
          if (m && m[1]) letAvailableDate = m[1].trim();
        }
        if (listingStatus === 'Unknown' || !listingStatus) {
          const m = text.match(/(?:Added|Reduced|Listed)\s+(?:on\s+\d{2}\/\d{2}\/\d{4}|today|yesterday|on\s+\d{1,2}\s+[a-zA-Z]+\s+\d{4})/i);
          if (m && m[0]) listingStatus = m[0].trim();
        }

        let derivedDate = null;
        if (listingStatus !== 'Unknown' && listingStatus) {
          const dateMatch = listingStatus.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            derivedDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          } else if (/today/i.test(listingStatus)) {
            derivedDate = new Date().toISOString().split('T')[0];
          } else if (/yesterday/i.test(listingStatus)) {
            const d = new Date(Date.now() - 86400000);
            derivedDate = d.toISOString().split('T')[0];
          }
        }

        if (derivedDate) {
          listingUpdate = derivedDate;
        } else if (listingUpdate === 'Unknown' || !listingUpdate || !/^\d{4}-\d{2}-\d{2}$/.test(listingUpdate)) {
          const textToParse = (listingStatus !== 'Unknown' ? listingStatus : '') + ' ' + (listingUpdate !== 'Unknown' ? listingUpdate : '');
          const isoMatch = textToParse.match(/(\d{4}-\d{2}-\d{2})/);
          if (isoMatch) {
            listingUpdate = isoMatch[1];
          } else {
            listingUpdate = 'Unknown';
          }
        }

        if (letAvailableDate !== 'Unknown' && typeof letAvailableDate === 'string') {
          letAvailableDate = letAvailableDate.replace(/^Let\s+available\s+date:\s*/i, '').trim();
        }

        return { letAvailableDate, listingStatus, listingUpdate, propertyName };
      }).catch(() => ({ letAvailableDate: 'Unknown', listingStatus: 'Unknown', listingUpdate: 'Unknown', propertyName: 'Unknown' }));

      const propertyName = detailMetadata.propertyName !== 'Unknown' ? detailMetadata.propertyName : (searchDates.displayAddress || 'Unknown');
      const letAvailableFormatted = detailMetadata.letAvailableDate !== 'Unknown' ? detailMetadata.letAvailableDate : (searchDates.letAvailableDate || 'Unknown');
      const listingStatus = detailMetadata.listingStatus !== 'Unknown' ? detailMetadata.listingStatus : (searchDates.addedOrReduced || 'Unknown');
      let listingUpdate = detailMetadata.listingUpdate !== 'Unknown' ? detailMetadata.listingUpdate : 
                          (searchDates.firstVisibleDate || searchDates.listingUpdateDate || 'Unknown');
      if (typeof listingUpdate === 'string' && listingUpdate !== 'Unknown') {
        listingUpdate = listingUpdate.split('T')[0];
      }
      if (listingUpdate === 'Unknown' && typeof listingStatus === 'string' && listingStatus !== 'Unknown') {
        const dateMatch = listingStatus.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          listingUpdate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        } else if (/today/i.test(listingStatus)) {
          listingUpdate = new Date().toISOString().split('T')[0];
        } else if (/yesterday/i.test(listingStatus)) {
          const d = new Date(Date.now() - 86400000);
          listingUpdate = d.toISOString().split('T')[0];
        }
      }

      if (sqm && sqm < config.minSqm) {
        const reason = `Size ${sqm} sqm below min ${config.minSqm}`;
        console.log(`Property ${listing.id} ignored: ${reason}`);
        markAsIgnored(listing.id, this.platformName, reason);
        return null;
      }

      return {
        platform: this.platformName,
        id: listing.id,
        price: listing.price,
        sqm: sqm || 0,
        location: locationName,
        propertyName: propertyName,
        agent: agentName || 'Unknown',
        url: `https://www.rightmove.co.uk/properties/${listing.id}`,
        listingUpdate: listingUpdate,
        listingStatus: listingStatus,
        letAvailableDate: letAvailableFormatted
      };

    } catch (error) {
      console.error(`Error processing ${listing.id}:`, error.message);
      return null;
    }
  }
}

module.exports = RightmoveAdapter;