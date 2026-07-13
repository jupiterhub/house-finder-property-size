const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TXT_FILE = path.join(DATA_DIR, 'matches.txt');
const MD_FILE = path.join(DATA_DIR, 'matches.md');
const HTML_FILE = path.join(DATA_DIR, 'matches.html');
const SEEN_FILE = path.join(DATA_DIR, 'seen_properties.json');
const { isDesiredAvailability, getDesiredAvailabilityConfig } = require('./utils/availability');
let config = {};
try {
  config = require('./config.json');
} catch (e) {}

function parseMatches(content) {
  const matches = [];
  // Split by the divider, whether it's the old '---' or new '---'
  const blocks = content.split(/---[-]*\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const match = {};
    
    // Parse timestamp
    const timestampMatch = block.match(/\[(.*?)\]/);
    if (timestampMatch) match.timestamp = new Date(timestampMatch[1]);

    // Parse Platform
    const platformMatch = block.match(/(?:Platform:|\*\*Platform\*\*:) (.*)/);
    if (platformMatch) match.platform = platformMatch[1].trim();
    if (!match.platform) {
      if (match.link && match.link.includes('rightmove.co.uk')) match.platform = 'Rightmove';
      else if (match.link && match.link.includes('jll')) match.platform = 'JLL';
      else if (match.agent && match.agent.toUpperCase().includes('JLL')) match.platform = 'JLL';
      else if (match.agent && match.agent.toUpperCase().includes('JOHNS&CO')) match.platform = 'JOHNS&CO';
      else if (match.agent && match.agent.toUpperCase().includes('KNIGHT FRANK')) match.platform = 'Knight Frank';
      else if (match.link && match.link.includes('zoopla')) match.platform = 'Zoopla';
      else match.platform = 'Rightmove';
    }

    // Parse Marketed by (or Agent)
    const agentMatch = block.match(/(?:Marketed by:|\*\*Marketed by\*\*:|Agent:|\*\*Agent\*\*:) (.*)/);
    if (agentMatch) match.agent = agentMatch[1].trim();
    else match.agent = 'Unknown';

    // Parse Location
    const locMatch = block.match(/(?:Location:|\*\*Location\*\*:) (.*)/);
    if (locMatch) match.location = locMatch[1].trim();
    else match.location = 'Unknown';

    // Parse Property Name
    const propNameMatch = block.match(/(?:Property Name:|\*\*Property Name\*\*:) (.*)/);
    if (propNameMatch) {
      let rawName = propNameMatch[1].trim();
      rawName = rawName.replace(/\[+([^\]]+)\]\(.*?\)/g, '$1');
      rawName = rawName.replace(/^\[+/, '');
      rawName = rawName.replace(/\]+.*$/, '');
      match.propertyName = rawName.trim();
    } else match.propertyName = 'Unknown';


    // Parse ID
    const idMatch = block.match(/(?:ID:|\*\*ID\*\*:) (.*)/);
    if (idMatch) match.id = idMatch[1].trim();

    // Parse Price
    const priceMatch = block.match(/(?:Price:|\*\*Price\*\*:) £?([\d,.]+)/);
    if (priceMatch) match.price = parseFloat(priceMatch[1].replace(/,/g, ''));

    // Parse Size
    const sizeMatch = block.match(/(?:Size:|\*\*Size\*\*:) ([\d,.]+) sqm/);
    if (sizeMatch) match.size = parseFloat(sizeMatch[1]);

    // Parse Listing Update
    const updateMatch = block.match(/(?:Listing Update:|\*\*Listing Update\*\*:) (.*)/);
    if (updateMatch) match.listingUpdate = updateMatch[1].trim();
    else match.listingUpdate = 'Unknown';

    // Parse Listing Status
    const statusMatch = block.match(/(?:Listing Status:|\*\*Listing Status\*\*:|Status:|\*\*Status\*\*:) (.*)/);
    if (statusMatch) match.listingStatus = statusMatch[1].trim();
    else match.listingStatus = 'Unknown';

    // Parse Let Available
    const availMatch = block.match(/(?:Let Available:|\*\*Let Available\*\*:|Let Available Date:|\*\*Let Available Date\*\*:) (.*)/);
    if (availMatch) match.letAvailableDate = availMatch[1].replace(/\s*\(\s*🦅\s*Early\s+Bird[^\)]*\)/gi, '').trim();
    else match.letAvailableDate = 'Unknown';

    // Parse Link
    const linkMatch = block.match(/(?:Link:|\*\*Link\*\*:) (?:\[.*?\]\()?(https?:\/\/[^\s\)]+)/);
    if (linkMatch) match.link = linkMatch[1].trim();

    if (match.id) {
      if (match.agent === 'Unknown' && (match.location === 'OpenRent (London)' || (match.link && match.link.toLowerCase().includes('openrent')))) {
        match.agent = 'OpenRent, London';
      }
      matches.push(match);
    }
  }

  return matches;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getGoogleMapsQuery(m) {
  let query = '';
  if (m.propertyName && m.propertyName !== 'Unknown') {
    query = m.propertyName;
    if (m.location && m.location !== 'Unknown' && !query.toLowerCase().includes(m.location.toLowerCase())) {
      query = `${query}, ${m.location}`;
    }
  } else if (m.location && m.location !== 'Unknown') {
    query = m.location;
  }
  return query;
}

function formatMatchMarkdown(match) {
  const ts = match.timestamp ? match.timestamp.toISOString() : new Date().toISOString();
  let earlyBirdStr = '';
  if (match.letAvailableDate && match.letAvailableDate !== 'Unknown') {
    let availTs = 0;
    const str = match.letAvailableDate;
    if (/now|immediate|today/i.test(str)) availTs = Date.now();
    else if (/(\d{2})\/(\d{2})\/(\d{4})/.test(str)) {
      const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
      if (!isNaN(d.getTime())) availTs = d.getTime();
    } else {
      const d = new Date(str);
      if (!isNaN(d.getTime())) availTs = d.getTime();
    }
    let updateTs = 0;
    if (match.listingUpdate && match.listingUpdate !== 'Unknown') {
      const d = new Date(match.listingUpdate);
      if (!isNaN(d.getTime())) updateTs = d.getTime();
    }
    const refTs = updateTs || (match.timestamp ? match.timestamp.getTime() : 0);
    if (availTs && refTs && availTs > refTs) {
      const leadDays = (availTs - refTs) / (1000 * 60 * 60 * 24);
      if (leadDays > 65) earlyBirdStr = ` (🦅 Early Bird: ${Math.round(leadDays)}d adv)`;
    }
  }
  const cleanAvail = (match.letAvailableDate || 'Unknown').replace(/\s*\(\s*🦅\s*Early\s+Bird[^\)]*\)/gi, '').trim();
  const propertyNameDisplay = match.propertyName || 'Unknown';
  return `### [${ts}] MATCH FOUND!\n` +
    `- **Platform**: ${match.platform || 'Rightmove'}\n` +
    `- **Marketed by**: ${match.agent || 'Unknown'}\n` +
    `- **Location**: ${match.location || 'Unknown'}\n` +
    `- **Property Name**: ${propertyNameDisplay}\n` +
    `- **ID**: ${match.id}\n` +
    `- **Price**: £${match.price} PCM\n` +
    `- **Size**: ${(match.size && match.size !== 0 && match.size !== '0') ? match.size + ' sqm' : 'Unknown'}\n` +
    `- **Listing Update**: ${match.listingUpdate || 'Unknown'}\n` +
    `- **Listing Status**: ${match.listingStatus || 'Unknown'}\n` +
    `- **Let Available**: ${cleanAvail}${earlyBirdStr}\n` +
    `- **Link**: [${match.link}](${match.link})\n\n` +
    `---\n\n`;
}

function tidySeenProperties() {
  if (!fs.existsSync(SEEN_FILE)) return;
  
  let seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
  
  // Backwards compatibility if it's an array
  if (Array.isArray(seen)) {
    seen = { "Rightmove": seen };
  }

  let totalRemoved = 0;
  let totalIDs = 0;

  for (const platform in seen) {
    const originalCount = seen[platform].length;
    // Deduplicate and sort
    seen[platform] = [...new Set(seen[platform])].sort((a, b) => a.localeCompare(b));
    totalRemoved += (originalCount - seen[platform].length);
    totalIDs += seen[platform].length;
  }
  
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  console.log(`Tidied seen_properties.json: Removed ${totalRemoved} duplicates and sorted ${totalIDs} IDs across platforms.`);
}

function extractRightmoveMetadata(html) {
  let letAvailableDate = 'Unknown';
  let listingStatus = 'Unknown';
  let listingUpdate = 'Unknown';
  let propertyName = 'Unknown';

  try {
    const pmMatch = html.match(/(?:window\.)?__PAGE_MODEL\s*=\s*(\{.+?\});/) || html.match(/(?:window\.)?PAGE_MODEL\s*=\s*(\{.+?\});/);
    if (pmMatch) {
      const pm = JSON.parse(pmMatch[1]);
      let pd = pm.propertyData || pm;
      let analyticsAdded = null;
      if (typeof pm.data === 'string') {
        const arr = JSON.parse(pm.data);
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
    }
  } catch (err) {}

  if (letAvailableDate === 'Unknown' || !letAvailableDate) {
    const m = html.match(/Let\s+available\s+date:\s*<\/dt>\s*<dd[^>]*>\s*([^<]+)/i) || 
              html.match(/Let\s+available\s+date:\s*([^\n<]+)/i);
    if (m && m[1]) letAvailableDate = m[1].replace(/<[^>]+>/g, '').trim();
  }

  if (listingStatus === 'Unknown' || !listingStatus) {
    const m = html.match(/(?:Added|Reduced|Listed)\s+(?:on\s+\d{2}\/\d{2}\/\d{4}|today|yesterday|on\s+\d{1,2}\s+[a-zA-Z]+\s+\d{4})/i);
    if (m && m[0]) listingStatus = m[0].replace(/<[^>]+>/g, '').trim();
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

  if (propertyName === 'Unknown' || !propertyName) {
    const mAddr = html.match(/displayAddress\\?"\s*:\s*\\?"([^"\\]+)/i);
    if (mAddr && mAddr[1]) propertyName = mAddr[1].trim();
  }

  return { letAvailableDate, listingStatus, listingUpdate, propertyName };
}

async function enrichMissingMetadata(matches) {
  const needsEnrichment = m => {
    if (m.platform && m.platform !== 'Rightmove' && !m.link?.includes('rightmove')) return false;
    if (!m.link) return false;
    if (!m.letAvailableDate || m.letAvailableDate === 'Unknown') return true;
    if (!m.listingUpdate || m.listingUpdate === 'Unknown' || !/^\d{4}-\d{2}-\d{2}$/.test(m.listingUpdate)) return true;
    if (!m.listingStatus || m.listingStatus === 'Unknown') return true;
    if (!m.propertyName || m.propertyName === 'Unknown') return true;
    return false;
  };

  const toEnrich = matches.filter(needsEnrichment);
  if (toEnrich.length === 0) {
    return matches;
  }
  console.log(`Enriching metadata for ${toEnrich.length} Rightmove properties...`);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
  };

  let count = 0;
  const batchSize = 5;
  for (let i = 0; i < toEnrich.length; i += batchSize) {
    const batch = toEnrich.slice(i, i + batchSize);
    await Promise.all(batch.map(async (item) => {
      try {
        const res = await fetch(item.link, { headers });
        if (res.status === 200) {
          const html = await res.text();
          const meta = extractRightmoveMetadata(html);
          if (meta.letAvailableDate && meta.letAvailableDate !== 'Unknown') item.letAvailableDate = meta.letAvailableDate;
          if (meta.listingStatus && meta.listingStatus !== 'Unknown') item.listingStatus = meta.listingStatus;
          if (meta.listingUpdate && meta.listingUpdate !== 'Unknown') item.listingUpdate = meta.listingUpdate;
          if (meta.propertyName && meta.propertyName !== 'Unknown') item.propertyName = meta.propertyName;
        }
      } catch (err) {}
      count++;
    }));
    if (count % 20 === 0 || count === toEnrich.length) {
      console.log(`Enriched ${count}/${toEnrich.length}...`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`Metadata enrichment complete.`);
  return matches;
}

async function verifyMatches(matches) {
  console.log(`Starting live verification of ${matches.length} matches...`);
  
  const rightmoveMatches = matches.filter(m => !m.platform || m.platform === 'Rightmove' || (m.link && m.link.includes('rightmove')));

  console.log(`Rightmove matches to check: ${rightmoveMatches.length}`);

  const results = [];
  
  // Rightmove checking (HTTP fetch)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
  };

  let count = 0;
  for (const item of rightmoveMatches) {
    count++;
    if (count % 20 === 0 || count === 1) {
      console.log(`Verifying Rightmove ${count}/${rightmoveMatches.length}...`);
    }

    try {
      // 200ms delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));

      const res = await fetch(item.link, { headers });
      
      if (res.status === 404 || res.status === 410) {
        console.log(`- Property ${item.id} is off-market (Status ${res.status})`);
        continue;
      }
      
      if (res.status !== 200) {
        // Keep it if status is not 200 but not off-market (e.g. rate limit / temporary block)
        results.push(item);
        continue;
      }

      const html = await res.text();
      const isLetAgreed = html.includes('"letAgreed":true') || 
                          html.includes('"status":"LET_AGREED"') || 
                          /let agreed/i.test(html) ||
                          html.includes('LET_AGREED');

      const isNoLongerMarket = /no longer on the market/i.test(html) || 
                               /removed by the agent/i.test(html);

      if (isLetAgreed) {
        console.log(`- Property ${item.id} is Let Agreed`);
      } else if (isNoLongerMarket) {
        console.log(`- Property ${item.id} is no longer on the market`);
      } else {
        const meta = extractRightmoveMetadata(html);
        if (meta.letAvailableDate && meta.letAvailableDate !== 'Unknown') item.letAvailableDate = meta.letAvailableDate;
        if (meta.listingStatus && meta.listingStatus !== 'Unknown') item.listingStatus = meta.listingStatus;
        if (meta.listingUpdate && meta.listingUpdate !== 'Unknown') item.listingUpdate = meta.listingUpdate;
        if (meta.propertyName && meta.propertyName !== 'Unknown') item.propertyName = meta.propertyName;
        results.push(item);
      }
    } catch (err) {
      // In case of error, default to keeping it in the list
      results.push(item);
    }
  }

  const removedCount = matches.length - results.length;
  return results;
}

function matchesAllowedLocations(m, allowedLocations) {
  if (!allowedLocations || !Array.isArray(allowedLocations) || allowedLocations.length === 0) {
    return true;
  }
  const keywords = [];
  for (const loc of allowedLocations) {
    const tokens = loc.split(/[\/\(\),]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    keywords.push(...tokens);
    if (loc.toLowerCase().includes('canary wharf')) keywords.push('e14', 'wood wharf');
    if (loc.toLowerCase().includes('wood wharf')) keywords.push('e14', 'canary wharf', 'wood wharf');
    if (loc.toLowerCase().includes('south quay')) keywords.push('e14', 'marsh wall', 'millwall');
    if (loc.toLowerCase().includes('greenwich peninsula')) keywords.push('se10', 'upper riverside', 'north greenwich');
    if (loc.toLowerCase().includes('woolwich') || loc.toLowerCase().includes('royal arsenal')) keywords.push('se18', 'royal arsenal', 'woolwich');
    if (loc.toLowerCase().includes('paddington')) keywords.push('w2');
    if (loc.toLowerCase().includes('moorgate')) keywords.push('ec2');
    if (loc.toLowerCase().includes('bloomsbury')) keywords.push('russell square', 'wc1');
    if (loc.toLowerCase().includes('farringdon')) keywords.push('clerkenwell', 'ec1');
  }

  const locStr = (m.location || '').toLowerCase();
  const propStr = (m.propertyName || '').toLowerCase();

  return keywords.some(kw => {
    return locStr.includes(kw) || propStr.includes(kw) || (locStr.includes('openrent') && propStr.includes(kw));
  });
}

function deduplicatePhysicalProperties(matches) {
  const kept = [];
  let mergedCount = 0;

  function getNormalizedTokens(str) {
    if (!str || str === 'Unknown') return [];
    return str.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !['bedroom', 'apartment', 'flat', 'penthouse', 'studio', 'london', 'canary', 'wharf', 'floor', 'pcm', 'let', 'street', 'road', 'way', 'square', 'building', 'tower', 'place'].includes(w));
  }

  function areSameProperty(a, b) {
    if (a.id === b.id) return true;
    if (a.link && b.link && a.link === b.link) return true;

    // Must have very close price (within £15 PCM tolerance)
    const priceA = a.price || 0;
    const priceB = b.price || 0;
    if (!priceA || !priceB || Math.abs(priceA - priceB) > 15) return false;

    // Check size if both are known (> 0), allowing up to 15 sqm tolerance for OCR or estimation inaccuracies
    const sizeA = a.size || 0;
    const sizeB = b.size || 0;
    if (sizeA > 0 && sizeB > 0 && Math.abs(sizeA - sizeB) > 15) return false;

    // Compare address / propertyName
    const nameA = (a.propertyName || '').toLowerCase().trim();
    const nameB = (b.propertyName || '').toLowerCase().trim();
    if (nameA !== 'unknown' && nameB !== 'unknown' && nameA === nameB) {
      return true;
    }

    const tokensA = getNormalizedTokens(a.propertyName);
    const tokensB = getNormalizedTokens(b.propertyName);
    if (tokensA.length === 0 || tokensB.length === 0) return false;

    const common = tokensA.filter(t => tokensB.includes(t));
    if (common.length >= 2) return true;

    if (tokensA.every(t => tokensB.includes(t)) || tokensB.every(t => tokensA.includes(t))) {
      return true;
    }

    return false;
  }

  for (const m of matches) {
    const existingIdx = kept.findIndex(ex => areSameProperty(ex, m));
    if (existingIdx === -1) {
      kept.push(m);
    } else {
      mergedCount++;
      const existing = kept[existingIdx];
      // Keep the record with richer metadata
      if ((!existing.size || existing.size === 0) && m.size && m.size > 0) {
        existing.size = m.size;
      }
      if (existing.location === 'Unknown' && m.location && m.location !== 'Unknown') {
        existing.location = m.location;
      }
      if (existing.agent === 'Unknown' && m.agent && m.agent !== 'Unknown') {
        existing.agent = m.agent;
      }
      if (existing.letAvailableDate === 'Unknown' && m.letAvailableDate && m.letAvailableDate !== 'Unknown') {
        existing.letAvailableDate = m.letAvailableDate;
      }
    }
  }

  if (mergedCount > 0) {
    console.log(`Deduplicated ${mergedCount} cross-listing/cross-platform duplicate properties.`);
  }

  return kept;
}

async function main() {
  const args = process.argv.slice(2);
  const availabilityConfig = getDesiredAvailabilityConfig(config);
  const flags = {
    maxPrice: config.maxPrice || null,
    sort: 'ideal',
    order: 'desc',
    output: null,
    cleanSeen: false,
    migrate: false,
    verify: false,
    targetDate: null,
    window: availabilityConfig.windowDays !== undefined ? availabilityConfig.windowDays : 14,
    includeUnknownAvailability: availabilityConfig.includeUnknownAvailability,
    filterAvailability: false,
    platform: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-price') flags.maxPrice = parseFloat(args[++i]);
    else if (args[i] === '--agent' || args[i] === '--marketed-by' || args[i] === '--filter-agent') flags.agent = args[++i];
    else if (args[i] === '--sort') flags.sort = args[++i];
    else if (args[i] === '--order') flags.order = args[++i];
    else if (args[i] === '--output') flags.output = args[++i];
    else if (args[i] === '--clean-seen') flags.cleanSeen = true;
    else if (args[i] === '--migrate') flags.migrate = true;
    else if (args[i] === '--verify') flags.verify = true;
    else if (args[i] === '--target-date' || args[i] === '--move-in' || args[i] === '--desired-availability-date') {
      flags.targetDate = args[++i];
      flags.filterAvailability = true;
    }
    else if (args[i] === '--window') flags.window = parseInt(args[++i], 10);
    else if (args[i] === '--filter-availability') flags.filterAvailability = true;
    else if (args[i] === '--no-filter-availability') flags.filterAvailability = false;
  }

  if (flags.cleanSeen) {
    tidySeenProperties();
  }

  let allMatches = [];

  // Load matches from both files if they exist
  if (fs.existsSync(TXT_FILE)) {
    allMatches = allMatches.concat(parseMatches(fs.readFileSync(TXT_FILE, 'utf-8')));
  }
  if (fs.existsSync(MD_FILE)) {
    allMatches = allMatches.concat(parseMatches(fs.readFileSync(MD_FILE, 'utf-8')));
  }

  // Deduplicate by ID, preferring entries with a known location
  const uniqueMatchesMap = new Map();
  for (const m of allMatches) {
    if (!uniqueMatchesMap.has(m.id)) {
      uniqueMatchesMap.set(m.id, m);
    } else {
      // If we already have this ID, overwrite it if the new one has a better location
      const existing = uniqueMatchesMap.get(m.id);
      if (existing.location === 'Unknown' && m.location && m.location !== 'Unknown') {
        uniqueMatchesMap.set(m.id, m);
      }
    }
  }
  let uniqueMatches = Array.from(uniqueMatchesMap.values());
  uniqueMatches = deduplicatePhysicalProperties(uniqueMatches);

  let result = uniqueMatches;

  // Run live verification if --verify flag is set
  if (flags.verify) {
    result = await verifyMatches(result);
  } else {
    result = await enrichMissingMetadata(result);
  }

  // Filter
  if (config.locations && Array.isArray(config.locations) && config.locations.length > 0) {
    const preLocCount = result.length;
    result = result.filter(m => matchesAllowedLocations(m, config.locations));
    console.log(`Filtered out locations not in config.json (${config.locations.length} active areas): ${preLocCount} -> ${result.length} matches.`);
  }

  if (config.excludedAgents && Array.isArray(config.excludedAgents) && config.excludedAgents.length > 0) {
    const preAgentCount = result.length;
    result = result.filter(m => {
      const agentStr = (m.agent || '').toLowerCase();
      return !config.excludedAgents.some(ex => agentStr.includes(ex.toLowerCase()));
    });
    console.log(`Filtered out excluded agents (${config.excludedAgents.join(', ')}): ${preAgentCount} -> ${result.length} matches.`);
  }

  if (flags.maxPrice) {
    result = result.filter(m => m.price <= flags.maxPrice);
  }
  if (flags.agent) {
    const query = flags.agent.toLowerCase();
    result = result.filter(m => (m.agent || 'Unknown').toLowerCase().includes(query));
  }
  if (flags.platform) {
    const query = flags.platform.toLowerCase();
    result = result.filter(m => (m.platform || 'Rightmove').toLowerCase().includes(query));
  }
  if (flags.filterAvailability && flags.targetDate) {
    const initialCount = result.length;
    result = result.filter(m => {
      const check = isDesiredAvailability(m.letAvailableDate, {
        desiredAvailabilityDate: flags.targetDate,
        availabilityWindowDays: flags.window,
        includeUnknownAvailability: flags.includeUnknownAvailability
      });
      return check.kept;
    });
    console.log(`Filtered out noise by desired availability date (${flags.targetDate}, tolerance ±${flags.window}d): ${initialCount} -> ${result.length} matches.`);
  }

  // Sort
  result.sort((a, b) => {
    if (flags.sort === 'ideal') {
      // Primary: SQM size (descending)
      const sizeA = a.size || 0;
      const sizeB = b.size || 0;
      if (sizeA !== sizeB) {
        return sizeB - sizeA;
      }

      // Secondary: Price (ascending)
      const priceA = a.price || 0;
      const priceB = b.price || 0;
      if (priceA !== priceB) {
        return priceA - priceB;
      }

      // Tertiary: Recent match date (descending)
      const timeA = a.timestamp ? a.timestamp.getTime() : 0;
      const timeB = b.timestamp ? b.timestamp.getTime() : 0;
      if (timeA !== timeB) {
        return timeB - timeA;
      }

      // Quaternary: Location (ascending)
      const locA = a.location || 'Unknown';
      const locB = b.location || 'Unknown';
      return locA.localeCompare(locB);
    }
    
    if (flags.sort === 'recent') {
      // Primary: Recent match date (descending)
      const timeA = a.timestamp ? a.timestamp.getTime() : 0;
      const timeB = b.timestamp ? b.timestamp.getTime() : 0;
      
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      
      // Secondary: SQM size (descending)
      const sizeA = a.size || 0;
      const sizeB = b.size || 0;
      if (sizeA !== sizeB) {
        return sizeB - sizeA;
      }

      // Tertiary: Price (ascending)
      const priceA = a.price || 0;
      const priceB = b.price || 0;
      if (priceA !== priceB) {
        return priceA - priceB;
      }

      // Quaternary: Location (ascending)
      const locA = a.location || 'Unknown';
      const locB = b.location || 'Unknown';
      return locA.localeCompare(locB);
    }

    // Support multi-column sorting (e.g. 'date,price' or 'date:desc,price:asc')
    const sortCols = flags.sort.split(',').map(s => s.trim());
    const orderCols = flags.order ? flags.order.split(',').map(s => s.trim()) : [];

    for (let idx = 0; idx < sortCols.length; idx++) {
      let col = sortCols[idx];
      let dir = orderCols[idx] || orderCols[0] || 'desc';
      if (col.includes(':')) {
        const parts = col.split(':');
        col = parts[0].trim();
        dir = parts[1].trim();
      }

      let valA = a[col];
      let valB = b[col];

      if (col === 'date' || col === 'timestamp' || col === 'recent') {
        valA = a.timestamp ? a.timestamp.getTime() : 0;
        valB = b.timestamp ? b.timestamp.getTime() : 0;
        dir = orderCols[idx] || orderCols[0] || 'desc';
      } else if (col === 'agent' || col === 'marketed-by' || col === 'marketedBy') {
        valA = (a.agent || 'Unknown').toLowerCase();
        valB = (b.agent || 'Unknown').toLowerCase();
      } else if (col === 'price') {
        valA = a.price || 0;
        valB = b.price || 0;
        if (!orderCols[idx] && !col.includes(':')) dir = 'asc'; // default price sort to asc
      } else if (col === 'size') {
        valA = a.size || 0;
        valB = b.size || 0;
      } else if (col === 'location') {
        valA = (a.location || 'Unknown').toLowerCase();
        valB = (b.location || 'Unknown').toLowerCase();
      } else if (col === 'listingUpdate' || col === 'listed') {
        valA = (a.listingUpdate || 'Unknown').toLowerCase();
        valB = (b.listingUpdate || 'Unknown').toLowerCase();
      } else if (col === 'listingStatus' || col === 'status') {
        valA = (a.listingStatus || 'Unknown').toLowerCase();
        valB = (b.listingStatus || 'Unknown').toLowerCase();
      } else if (col === 'letAvailableDate' || col === 'available' || col === 'target' || col === 'move-in' || col === 'proximity') {
        const parseDateTs = (str) => {
          if (!str || str === 'Unknown') return 0;
          if (/now|immediate|today/i.test(str)) return Date.now();
          if (/(\d{2})\/(\d{2})\/(\d{4})/.test(str)) {
            const mDate = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const d = new Date(`${mDate[3]}-${mDate[2]}-${mDate[1]}`);
            if (!isNaN(d.getTime())) return d.getTime();
          }
          const d = new Date(str);
          return !isNaN(d.getTime()) ? d.getTime() : 0;
        };
        valA = parseDateTs(a.letAvailableDate || 'Unknown');
        valB = parseDateTs(b.letAvailableDate || 'Unknown');
        if (col === 'target' || col === 'move-in' || col === 'proximity') {
          const targetTs = flags.targetDate ? new Date(flags.targetDate).getTime() : Date.now();
          valA = valA > 0 ? Math.abs(valA - targetTs) : 9999999999999;
          valB = valB > 0 ? Math.abs(valB - targetTs) : 9999999999999;
          if (!orderCols[idx] && !col.includes(':')) dir = 'asc';
        }
      }

      if (valA !== valB) {
        if (dir === 'asc') return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
      }
    }

    // Default secondary sort if only 1 column was specified: sort ties by price ascending
    if (sortCols.length === 1 && sortCols[0] !== 'price') {
      const priceA = a.price || 0;
      const priceB = b.price || 0;
      if (priceA !== priceB) return priceA - priceB;
    }

    return 0;
  });

  const outputContent = result.map(formatMatchMarkdown).join('');

  const targetFile = flags.output || MD_FILE;
  
  if (flags.migrate || args.length >= 0) {
    fs.writeFileSync(targetFile, outputContent);
    console.log(`Updated ${targetFile} with ${result.length} matches (sorted by ${flags.sort} ${flags.order}).`);
    
    // Generate HTML
    const htmlFile = flags.output ? flags.output.replace(/\.md$/, '.html') : HTML_FILE;
    if (htmlFile !== targetFile) {
      // Calculate Deal Rating / Value Score Percentiles across all matches
      const allPpsqms = result
        .filter(m => m.price && m.size && m.size > 0)
        .map(m => m.price / m.size)
        .sort((a, b) => a - b);
      let p20Ppsqm = 999;
      let p40Ppsqm = 999;
      if (allPpsqms.length > 0) {
        p20Ppsqm = allPpsqms[Math.floor(allPpsqms.length * 0.2)] || 40;
        p40Ppsqm = allPpsqms[Math.floor(allPpsqms.length * 0.45)] || 45;
      }

      const htmlRows = result.map((m, idx) => {
        const dateStr = m.timestamp ? m.timestamp.toISOString().replace(/T/, ' ').replace(/\..+/, '') : '';
        const timestamp = m.timestamp ? m.timestamp.getTime() : 0;
        const pricePerSqm = (m.price && m.size) ? (m.price / m.size).toFixed(2) : 'N/A';
        const pricePerSqmValue = (m.price && m.size) ? (m.price / m.size) : 0;
        const badgeClass = 'badge-rightmove';
        const agentStr = m.agent || 'Unknown';
        const isOpenRent = agentStr.toLowerCase().includes('openrent');
        const agentBadge = isOpenRent ? 
          `<span class="badge badge-openrent">✨ ${agentStr}</span>` : 
          `<span class="agent-name">${agentStr}</span>`;
        const listingUpdateStr = m.listingUpdate || 'Unknown';
        const listingStatusStr = m.listingStatus || 'Unknown';
        const letAvailableStr = m.letAvailableDate || 'Unknown';

        let updateTs = 0;
        if (listingUpdateStr && listingUpdateStr !== 'Unknown') {
          const d = new Date(listingUpdateStr);
          if (!isNaN(d.getTime())) updateTs = d.getTime();
        }

        let availTs = 0;
        if (letAvailableStr && letAvailableStr !== 'Unknown') {
          if (/now|immediate|today/i.test(letAvailableStr)) {
            availTs = Date.now();
          } else if (/(\d{2})\/(\d{2})\/(\d{4})/.test(letAvailableStr)) {
            const mDate = letAvailableStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const d = new Date(`${mDate[3]}-${mDate[2]}-${mDate[1]}`);
            if (!isNaN(d.getTime())) availTs = d.getTime();
          } else {
            const d = new Date(letAvailableStr);
            if (!isNaN(d.getTime())) availTs = d.getTime();
          }
        }

        const refTs = updateTs || (m.timestamp ? m.timestamp.getTime() : 0);
        const leadTimeDays = (availTs && refTs && availTs > refTs) ? (availTs - refTs) / (1000 * 60 * 60 * 24) : 0;
        const isEarlyBird = leadTimeDays > 65;
        const earlyBirdBadge = isEarlyBird ? `<br><span class="badge badge-earlybird" title="Listed ${Math.round(leadTimeDays)} days before let available date!">🦅 Early Bird (${Math.round(leadTimeDays)}d adv)</span>` : '';

        const platformStr = m.platform || 'Rightmove';
        const platformLower = platformStr.toLowerCase().replace(/[^a-z]/g, '');
        const platformIcon = platformLower.includes('rightmove') ? '🏠 ' :
                             platformLower.includes('jll') ? '🏢 ' :
                             platformLower.includes('johns') ? '🏙️ ' :
                             platformLower.includes('knight') ? '🏰 ' : '🌐 ';
        const platformClass = platformLower.includes('rightmove') ? 'badge-platform-rightmove' :
                              platformLower.includes('jll') ? 'badge-platform-jll' :
                              platformLower.includes('johns') ? 'badge-platform-johnsandco' :
                              platformLower.includes('knight') ? 'badge-platform-knightfrank' : 'badge-platform-rightmove';
        const platformBadge = `<span class="badge-platform ${platformClass}">${platformIcon}${platformStr}</span>`;

        let dealBadge = '';
        let dealType = 'fair';
        if (pricePerSqmValue > 0 && pricePerSqmValue <= p20Ppsqm) {
          dealBadge = `<br><span class="badge badge-deal badge-deal-bargain" title="Top 20% lowest £/sqm value!">💎 Bargain</span>`;
          dealType = 'bargain';
        } else if (pricePerSqmValue > 0 && pricePerSqmValue <= p40Ppsqm) {
          dealBadge = `<br><span class="badge badge-deal badge-deal-good" title="Good £/sqm value">👍 Good Value</span>`;
          dealType = 'good';
        } else if (pricePerSqmValue > 0) {
          dealBadge = `<br><span class="badge badge-deal badge-deal-fair">⚖️ Market Rate</span>`;
          dealType = 'fair';
        }

        const mapsQuery = getGoogleMapsQuery(m);
        const mapsSearchUrl = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : '';
        let propertyNameCell = `${escapeHtml(m.propertyName || 'Unknown')}`;
        if (mapsSearchUrl && m.propertyName && m.propertyName !== 'Unknown') {
          propertyNameCell = `<a href="${mapsSearchUrl}" target="_blank" class="property-maps-link" title="Open in Google Maps (New Tab)" onclick="event.stopPropagation()">${escapeHtml(m.propertyName)}</a>`;
        }


        const textToCheck = `${m.propertyName || ''} ${m.description || ''} ${m.location || ''}`.toLowerCase();
        let targetTowerName = '';
        if (textToCheck.includes('hoola')) targetTowerName = 'Hoola';
        else if (textToCheck.includes('royal eden')) targetTowerName = 'Royal Eden Docks';
        else if (textToCheck.includes('royal docks west')) targetTowerName = 'Royal Docks West';
        else if (textToCheck.includes('pan peninsula')) targetTowerName = 'Pan Peninsula';
        else if (textToCheck.includes('arena tower') || textToCheck.includes('baltimore tower')) targetTowerName = 'Arena Tower';
        else if (textToCheck.includes('south quay plaza') || textToCheck.includes('sqp')) targetTowerName = 'South Quay Plaza';
        else if (textToCheck.includes('wardian')) targetTowerName = 'Wardian';
        else if (textToCheck.includes('upper riverside')) targetTowerName = 'Upper Riverside';
        else if (textToCheck.includes('peninsula gardens')) targetTowerName = 'Peninsula Gardens';
        else if (textToCheck.includes('lower riverside')) targetTowerName = 'Lower Riverside';

        const targetTowerBadge = targetTowerName ? `<br><span class="badge badge-targettower" title="Key Target Glass Tower Development">🏛️ Key Tower: ${targetTowerName}</span>` : '';

        const noteBtn = `<button class="note-btn note-icon-btn" id="note-btn-${m.id}" onclick="openNoteModal('${m.id}')" title="Add / View Note">📝</button>`;
        const hasSize = (m.size && m.size !== 0 && m.size !== '0');
        const sizeDisplay = hasSize ? `${m.size} sqm` : 'Unknown';
        const ppsqmDisplay = hasSize && pricePerSqm !== 'N/A' ? `£${pricePerSqm}${dealBadge}` : 'N/A';

        return `<tr data-id="${m.id}" data-index="${idx}" data-platform="${platformStr}" data-deal="${dealType}" data-early-bird="${isEarlyBird ? 'true' : 'false'}" data-target-tower="${targetTowerName ? 'true' : 'false'}">
          <td data-value="${timestamp}">${dateStr}</td>
          <td data-value="${updateTs}">${listingUpdateStr}</td>
          <td data-value="${listingStatusStr}">${listingStatusStr}</td>
          <td data-value="${availTs}"><span class="avail-text">${letAvailableStr}</span><span class="compat-indicator"></span>${earlyBirdBadge}</td>
          <td data-value="${platformStr}">${platformBadge}</td>
          <td data-value="${agentStr}">${agentBadge}</td>
          <td data-value="${escapeHtml(m.location || 'Unknown')}">${m.location || 'Unknown'}</td>
          <td data-value="${escapeHtml(m.propertyName || 'Unknown')}">${propertyNameCell}${targetTowerBadge}</td>
          <td class="numeric" data-value="${m.price || 0}">£${m.price || 0}</td>
          <td class="numeric" data-value="${m.size || 0}">${sizeDisplay}</td>
          <td class="numeric" data-value="${pricePerSqmValue}">${ppsqmDisplay}</td>
          <td style="text-align: center;">${noteBtn}</td>
          <td style="text-align: center;"><a href="${m.link}" target="_blank" class="view-btn" onclick="markRowSeen('${m.id}')" onauxclick="if (event.button === 1) markRowSeen('${m.id}')">View</a></td>
          <td style="text-align: center;"><button class="star-btn" onclick="toggleStar('${m.id}', this)" title="Save Property">☆</button></td>
        </tr>`;
      }).join('\n');

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
<title>Property Matches</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0f172a;
    --card-bg: #1e293b;
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --border: #334155;
    --primary: #3b82f6;
    --primary-hover: #2563eb;
    --rightmove: #00ad80;
    --danger: #ef4444;
    --danger-hover: #dc2626;
  }
  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 30px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    margin: 0;
  }
  .header-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
    gap: 12px;
    background: var(--card-bg);
    padding: 12px 18px;
    border-radius: 10px;
    border: 1px solid var(--border);
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }
  .title-area h2 {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 700;
    background: linear-gradient(135deg, #60a5fa, #3b82f6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .stats {
    color: var(--text-muted);
    font-size: 0.85em;
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .search-container {
    flex-grow: 1;
    max-width: 400px;
  }
  .search-container label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 5px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  #globalSearch {
    width: 100%;
    padding: 10px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-sizing: border-box;
    font-size: 0.95rem;
    color: var(--text);
    transition: all 0.2s;
  }
  #globalSearch:focus {
    border-color: var(--primary);
    outline: 0;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
  }
  
  .table-wrapper {
    background: var(--card-bg);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    overflow: auto;
    border: 1px solid var(--border);
    max-height: 80vh;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    border-spacing: 0;
  }
  th {
    position: sticky;
    top: 0;
    background: #1e293b;
    z-index: 10;
    text-align: left;
    padding: 16px 20px;
    cursor: pointer;
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    transition: background-color 0.2s;
  }
  th:hover {
    background-color: #334155;
  }
  td {
    padding: 16px 20px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
    color: #e2e8f0;
  }
  tr:last-child td {
    border-bottom: none;
  }
  tr:hover {
    background-color: rgba(255, 255, 255, 0.02);
  }
  
  /* Platform Badge Styles */
  .badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-rightmove {
    background: rgba(0, 173, 128, 0.15);
    color: var(--rightmove);
    border: 1px solid rgba(0, 173, 128, 0.3);
  }
  .badge-openrent {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(37, 99, 235, 0.15));
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.1);
  }
  .agent-name {
    font-weight: 600;
    color: #e2e8f0;
  }
  .quick-actions-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    background: rgba(255, 255, 255, 0.02);
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin: 6px 0;
  }
  .action-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .action-divider {
    width: 1px;
    height: 24px;
    background: var(--border);
    margin: 0 4px;
  }
  @media (max-width: 768px) {
    .action-divider { display: none; }
    .quick-actions-bar { flex-direction: column; align-items: flex-start; }
  }
  .quick-filters, .quick-sorts {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .filter-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .filter-chip {
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    border-radius: 20px;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .filter-chip:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
    transform: translateY(-1px);
  }
  .filter-chip.active {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
  }
  .filter-chip.chip-openrent.active {
    background: linear-gradient(135deg, #0284c7, #2563eb);
    border-color: #38bdf8;
    color: white;
    box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
  }
  .filter-chip.chip-goodvalue.active {
    background: linear-gradient(135deg, #059669, #10b981);
    border-color: #34d399;
    color: white;
    box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
  }
  .filter-chip.chip-excludenow.active {
    background: linear-gradient(135deg, #dc2626, #ef4444);
    border-color: #f87171;
    color: white;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
  }
  .filter-chip.chip-targettower.active {
    background: linear-gradient(135deg, #d97706, #f59e0b);
    border-color: #fbbf24;
    color: white;
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.4);
  }
  .badge-targettower {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.2));
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.4);
    font-weight: 700;
  }
  .badge-earlybird {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
    color: #f472b6;
    border: 1px solid rgba(236, 72, 153, 0.4);
    box-shadow: 0 0 12px rgba(236, 72, 153, 0.2);
  }
  .badge-platform {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 0.8em;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge-platform-rightmove {
    background: rgba(30,136,229,0.15);
    color: #64b5f6;
    border: 1px solid rgba(30,136,229,0.3);
  }
  .badge-platform-jll {
    background: rgba(229,57,53,0.15);
    color: #ef5350;
    border: 1px solid rgba(229,57,53,0.3);
  }
  .badge-platform-johnsandco {
    background: rgba(251,140,0,0.15);
    color: #ffb74d;
    border: 1px solid rgba(251,140,0,0.3);
  }
  .badge-platform-knightfrank {
    background: rgba(67,160,71,0.15);
    color: #81c784;
    border: 1px solid rgba(67,160,71,0.3);
  }
  .badge-deal {
    margin-top: 4px;
    display: inline-block;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .badge-deal-bargain {
    background: linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.25));
    color: #34d399;
    border: 1px solid rgba(52,211,153,0.4);
    box-shadow: 0 0 10px rgba(16,185,129,0.25);
  }
  .badge-deal-good {
    background: rgba(16,185,129,0.12);
    color: #6ee7b7;
    border: 1px solid rgba(52,211,153,0.25);
  }
  .badge-deal-fair {
    background: rgba(148,163,184,0.1);
    color: #94a3b8;
    border: 1px solid rgba(148,163,184,0.2);
  }
  .crm-status-select {
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 3px 1px;
    font-size: 1.1em;
    cursor: pointer;
    width: 42px;
    text-align: center;
    text-align-last: center;
  }
  tr.row-ruledout {
    opacity: 0.45;
  }
  tr.row-ruledout td {
    text-decoration: line-through;
  }
  .note-btn {
    background: #1e293b;
    color: #94a3b8;
    border: 1px solid #334155;
    border-radius: 6px;
    width: 34px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1em;
    cursor: pointer;
    padding: 0;
    transition: all 0.2s;
  }
  .note-btn:hover {
    border-color: #60a5fa;
    color: #60a5fa;
  }
  .note-btn.has-note {
    background: rgba(245, 158, 11, 0.18);
    border-color: #f59e0b;
    color: #facc15;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.35);
  }
  .btn-export {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 6px 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(16,185,129,0.3);
    transition: all 0.2s ease;
  }
  .btn-export:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 16px rgba(16,185,129,0.5);
  }
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .modal-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 450px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }
  .modal-card h3 {
    margin-top: 0;
    color: #f8fafc;
  }
  .modal-card textarea {
    width: 100%;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    color: #e2e8f0;
    padding: 10px;
    font-family: inherit;
    font-size: 0.9rem;
    box-sizing: border-box;
    margin-bottom: 16px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .btn-cancel {
    background: transparent;
    border: 1px solid #475569;
    color: #94a3b8;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
  }
  .btn-save {
    background: #3b82f6;
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .badge-earlybird {
    margin-top: 4px;
    display: inline-block;
  }
  .chip-earlybird.active {
    background: linear-gradient(135deg, #9333ea, #db2777);
    border-color: #f472b6;
    color: white;
    box-shadow: 0 0 15px rgba(236, 72, 153, 0.4);
  }
  .chip-target.active {
    background: linear-gradient(135deg, #10b981, #059669);
    border-color: #34d399;
    color: white;
    box-shadow: 0 0 15px rgba(52, 211, 153, 0.4);
  }
  .move-in-assistant {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 8px;
    padding: 8px 14px;
    margin: 6px 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    transition: all 0.2s ease;
  }
  .move-in-assistant:hover {
    border-color: rgba(56, 189, 248, 0.45);
  }
  .assistant-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .assistant-icon {
    font-size: 1.1rem;
  }
  .assistant-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #38bdf8;
  }
  .assistant-subtitle {
    display: none;
  }
  .assistant-controls {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  .control-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .control-group label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #cbd5e1;
  }
  .control-group input[type="date"], .control-group select {
    background: #0f172a;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: #f8fafc;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 500;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .control-group input[type="date"]:focus, .control-group select:focus {
    border-color: #38bdf8;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
  }
  .checkbox-group {
    display: flex;
    gap: 16px;
    background: rgba(255, 255, 255, 0.03);
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .toggle-check {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    color: #cbd5e1;
    user-select: none;
  }
  .toggle-check input[type="checkbox"] {
    accent-color: #38bdf8;
    width: 15px;
    height: 15px;
    cursor: pointer;
  }
  .chip-clear-movein {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #fbbf24;
  }
  .chip-clear-movein:hover {
    background: rgba(245, 158, 11, 0.25);
    color: #fef08a;
  }
  .compat-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 700;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .compat-spot-on {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  .compat-early {
    background: rgba(234, 179, 8, 0.15);
    color: #facc15;
    border: 1px solid rgba(234, 179, 8, 0.3);
  }
  .compat-advance {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }
  .compat-imm {
    background: rgba(148, 163, 184, 0.15);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.3);
  }
  .compat-ask-agent {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }
  .quick-sorts {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sort-indicator {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--primary);
    background: rgba(59, 130, 246, 0.15);
    padding: 1px 6px;
    border-radius: 10px;
    margin-left: 5px;
  }
  th {
    user-select: none;
    cursor: pointer;
  }
  th:hover {
    color: var(--primary);
  }
  .chip-clear {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }
  .chip-clear:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
  .tooltip-container {
    position: relative;
    display: inline-block;
    margin-left: 4px;
  }
  .tooltip-badge {
    cursor: help;
    font-size: 0.85rem;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.06);
    padding: 5px 12px;
    border-radius: 16px;
    border: 1px dashed var(--border);
    transition: all 0.2s ease;
  }
  .tooltip-container:hover .tooltip-badge {
    color: var(--text);
    border-color: var(--primary);
    background: rgba(59, 130, 246, 0.1);
  }
  .tooltip-popup {
    visibility: hidden;
    opacity: 0;
    width: 290px;
    background-color: var(--card-bg);
    color: var(--text);
    text-align: left;
    border-radius: 8px;
    padding: 12px;
    position: absolute;
    z-index: 100;
    top: 125%;
    left: 50%;
    transform: translateX(-50%);
    box-shadow: 0 10px 25px rgba(0,0,0,0.6);
    border: 1px solid var(--border);
    font-size: 0.8rem;
    line-height: 1.4;
    transition: opacity 0.2s, visibility 0.2s, transform 0.2s;
  }
  .tooltip-container:hover .tooltip-popup {
    visibility: visible;
    opacity: 1;
    transform: translateX(-50%) translateY(4px);
  }

  .numeric {
    text-align: right;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-weight: 600;
  }
  
  .filter-input {
    width: 100%;
    box-sizing: border-box;
    font-weight: normal;
    margin-top: 8px;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--text);
    transition: border-color 0.2s;
  }
  .filter-input:focus {
    border-color: var(--primary);
    outline: none;
  }

  .view-btn {
    display: inline-block;
    padding: 6px 14px;
    background: var(--primary);
    color: white !important;
    text-decoration: none;
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 600;
    transition: all 0.2s;
    border: none;
  }
  .view-btn:hover {
    background: var(--primary-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .star-btn {
    display: inline-block;
    padding: 3px 10px;
    background: rgba(255, 255, 255, 0.05);
    color: #94a3b8 !important;
    text-decoration: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 1.15em;
    cursor: pointer;
    transition: all 0.2s;
  }
  .star-btn:hover {
    background: rgba(234, 179, 8, 0.15);
    color: #facc15 !important;
    border-color: rgba(234, 179, 8, 0.4);
    transform: scale(1.1);
  }
  .star-btn.starred {
    background: rgba(234, 179, 8, 0.2);
    color: #facc15 !important;
    border-color: #facc15;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.3);
  }
  .chip-starred {
    background: rgba(234, 179, 8, 0.1);
    border-color: rgba(234, 179, 8, 0.3);
    color: #fde047;
  }
  .chip-starred.active {
    background: #eab308;
    color: #0f172a;
    border-color: #eab308;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.4);
  }
  .chip-viewed {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.3);
    color: #34d399;
  }
  .chip-viewed.active {
    background: #10b981;
    color: white;
    border-color: #10b981;
    box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
  }
  .chip-unviewed {
    background: rgba(56, 189, 248, 0.1);
    border-color: rgba(56, 189, 248, 0.3);
    color: #38bdf8;
  }
  .chip-unviewed.active {
    background: #0284c7;
    color: white;
    border-color: #0284c7;
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
  }
  #resetStarredBtn {
    padding: 3px 8px;
    background: rgba(234, 179, 8, 0.15);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.8em;
    transition: all 0.2s;
    margin-left: 8px;
  }
  #resetStarredBtn:hover {
    background: #eab308;
    color: #0f172a;
  }

  .seen-property-row {
    opacity: 0.55;
    background: rgba(255, 255, 255, 0.015);
  }
  .viewed-btn {
    background: rgba(16, 185, 129, 0.2) !important;
    color: #34d399 !important;
    border: 1px solid rgba(16, 185, 129, 0.4) !important;
  }
  .viewed-btn:hover {
    background: rgba(16, 185, 129, 0.3) !important;
    color: white !important;
  }
  #resetSeenBtn {
    padding: 3px 8px;
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.8em;
    transition: all 0.2s;
    margin-left: 8px;
  }
  #resetSeenBtn:hover {
    background: #059669;
    color: white;
  }
  .property-maps-link {
    color: #60a5fa;
    text-decoration: none;
    font-weight: 500;
  }
  .property-maps-link:hover {
    color: #93c5fd;
    text-decoration: underline;
  }
</style>
<script>
const STARRED_STORAGE_KEY = 'house_finder_starred_ids';
const SEEN_STORAGE_KEY = 'house_finder_seen_ids';

function getStarredIds() {
  try {
    return JSON.parse(localStorage.getItem(STARRED_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function getSeenIds() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function markRowSeen(id) {
  const seenIds = getSeenIds();
  if (!seenIds.includes(id)) {
    seenIds.push(id);
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seenIds));
  }
  setTimeout(applySeen, 100);
}

function resetSeen() {
  localStorage.removeItem(SEEN_STORAGE_KEY);
  applySeen();
}

function applySeen() {
  const seenIds = getSeenIds();
  const table = document.getElementById("matchesTable");
  if (!table) return;
  
  const tbody = table.getElementsByTagName("tbody")[0];
  const trs = tbody.getElementsByTagName("tr");
  
  let seenCount = 0;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const id = tr.getAttribute("data-id");
    const viewBtn = tr.querySelector(".view-btn");
    if (seenIds.includes(id)) {
      tr.classList.add("seen-property-row");
      if (viewBtn) {
        viewBtn.innerHTML = "✓ Viewed";
        viewBtn.classList.add("viewed-btn");
      }
      seenCount++;
    } else {
      tr.classList.remove("seen-property-row");
      if (viewBtn) {
        viewBtn.innerHTML = "View";
        viewBtn.classList.remove("viewed-btn");
      }
    }
  }

  const resetBtn = document.getElementById("resetSeenBtn");
  if (resetBtn) {
    if (seenCount > 0) {
      resetBtn.style.display = "inline-block";
      document.getElementById("seenCount").textContent = seenCount;
    } else {
      resetBtn.style.display = "none";
    }
  }
  
  filterTable();
}

function toggleStar(id, btn) {
  let starredIds = getStarredIds();
  if (starredIds.includes(id)) {
    starredIds = starredIds.filter(x => x !== id);
    if (btn) {
      btn.innerHTML = "☆";
      btn.classList.remove("starred");
      btn.title = "Save Property";
    }
  } else {
    starredIds.push(id);
    if (btn) {
      btn.innerHTML = "⭐";
      btn.classList.add("starred");
      btn.title = "Saved!";
    }
  }
  localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(starredIds));
  applyStarred();
}

function resetStarred() {
  localStorage.removeItem(STARRED_STORAGE_KEY);
  applyStarred();
}

function applyStarred() {
  const starredIds = getStarredIds();
  const table = document.getElementById("matchesTable");
  if (!table) return;
  
  const tbody = table.getElementsByTagName("tbody")[0];
  const trs = tbody.getElementsByTagName("tr");
  
  let starredCount = 0;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const id = tr.getAttribute("data-id");
    const starBtn = tr.querySelector(".star-btn");
    if (starredIds.includes(id)) {
      tr.classList.add("starred-property-row");
      if (starBtn) {
        starBtn.innerHTML = "⭐";
        starBtn.classList.add("starred");
        starBtn.title = "Saved!";
      }
      starredCount++;
    } else {
      tr.classList.remove("starred-property-row");
      if (starBtn) {
        starBtn.innerHTML = "☆";
        starBtn.classList.remove("starred");
        starBtn.title = "Save Property";
      }
    }
  }

  const resetBtn = document.getElementById("resetStarredBtn");
  if (resetBtn) {
    if (starredCount > 0) {
      resetBtn.style.display = "inline-block";
      document.getElementById("starredCount").textContent = starredCount;
    } else {
      resetBtn.style.display = "none";
    }
  }

  const chip = document.getElementById("chipStarred");
  if (chip) {
    chip.innerHTML = "⭐ Starred (" + starredCount + ")";
  }
  
  filterTable();
}

function filterTable() {
  var globalSearch = document.getElementById("globalSearch").value.toLowerCase();
  var table = document.getElementById("matchesTable");
  var tbody = table.getElementsByTagName("tbody")[0];
  var tr = tbody.getElementsByTagName("tr");
  var inputs = table.querySelectorAll("thead .filter-input");
  
  var visibleCount = 0;
  const starredIds = getStarredIds();
  const seenIds = getSeenIds();

  for (var i = 0; i < tr.length; i++) {
    var display = "";
    var id = tr[i].getAttribute("data-id");
    
    if (activeQuickFilter === "Starred" && !starredIds.includes(id)) {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "EarlyBird" && tr[i].getAttribute("data-early-bird") !== "true") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "Viewed" && !seenIds.includes(id)) {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "Unviewed" && seenIds.includes(id)) {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "Bargain" && tr[i].getAttribute("data-deal") !== "bargain") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "GoodValue" && tr[i].getAttribute("data-deal") !== "good" && tr[i].getAttribute("data-deal") !== "bargain") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "TargetTower" && tr[i].getAttribute("data-target-tower") !== "true") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "ExcludeNow") {
      var availTd = tr[i].getElementsByTagName("td")[3];
      if (availTd) {
        var availText = availTd.textContent.toLowerCase();
        var isNow = (availText.indexOf("now") !== -1 || availText.indexOf("immediate") !== -1 || availText.indexOf("today") !== -1);
        if (isNow) {
          tr[i].style.display = "none";
          continue;
        }
      }
    }

    if (activeQuickFilter === "Viewing" && tr[i].getAttribute("data-crm-status") !== "viewing") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "Contacted" && tr[i].getAttribute("data-crm-status") !== "contacted") {
      tr[i].style.display = "none";
      continue;
    }

    if (activeQuickFilter === "RuledOut" && tr[i].getAttribute("data-crm-status") !== "ruledout") {
      tr[i].style.display = "none";
      continue;
    }

    var compatLabelSelect = document.getElementById("compatLabelSelect");
    var compatLabelVal = compatLabelSelect ? compatLabelSelect.value : "";
    if (compatLabelVal) {
      var availTd = tr[i].getElementsByTagName("td")[3];
      if (!availTd || !availTd.querySelector(".compat-" + compatLabelVal)) {
        tr[i].style.display = "none";
        continue;
      }
    }

    var targetDateInput = document.getElementById("targetDateInput");
    var targetDateVal = targetDateInput ? targetDateInput.value : "";
    if (targetDateVal) {
      var targetTs = new Date(targetDateVal).getTime();
      var windowDays = parseInt(document.getElementById("windowSelect").value, 10);
      var incUnknown = document.getElementById("includeUnknownCheck") ? document.getElementById("includeUnknownCheck").checked : true;
      
      var availTd = tr[i].getElementsByTagName("td")[3];
      if (availTd) {
        var availTs = parseFloat(availTd.getAttribute("data-value")) || 0;
        var availText = availTd.textContent.toLowerCase();
        var isNow = (availText.indexOf("now") !== -1 || availText.indexOf("immediate") !== -1 || availText.indexOf("today") !== -1);
        var isUnknown = !isNow && (availTs === 0 || availText.indexOf("unknown") !== -1 || availText.indexOf("ask agent") !== -1);
        
        if (isUnknown && !incUnknown) {
          tr[i].style.display = "none";
          continue;
        } else if (!isUnknown && availTs > 0) {
          var diffDays = (availTs - targetTs) / (1000 * 60 * 60 * 24);
          if (windowDays === 999) {
            if (diffDays > 0) {
              tr[i].style.display = "none";
              continue;
            }
          } else if (windowDays === 3650) {
            // Any date (All) - keep visible
          } else {
            if (Math.abs(diffDays) > windowDays) {
              tr[i].style.display = "none";
              continue;
            }
          }
        }
      }
    }

    var rowText = tr[i].textContent.toLowerCase();
    
    // Global search check
    if (globalSearch && rowText.indexOf(globalSearch) === -1) {
      display = "none";
    } else {
      // Column-specific check
      for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        var filterValue = input.value.trim();
        if (!filterValue) continue;
        
        var colIndex = parseInt(input.getAttribute("data-col"), 10);
        var td = tr[i].getElementsByTagName("td")[colIndex];
        if (!td) continue;

        var cellValue = td.getAttribute("data-value");
        var type = input.getAttribute("data-type");
        var isNumeric = type === "numeric";
        var isDate = type === "date";

        if (isNumeric || isDate) {
          var numCellValue = parseFloat(cellValue !== null && cellValue !== "" ? cellValue : td.textContent.trim());
          var operatorMatch = filterValue.match(/^(>=|<=|>|<|=)?\\s*(.*)/);
          var operator = (operatorMatch && operatorMatch[1]) ? operatorMatch[1] : '';
          var filterRaw = operatorMatch ? operatorMatch[2].trim() : filterValue;
          
          if (filterRaw) {
            var numFilterValue;
            if (isDate) {
              var d = new Date(filterRaw);
              numFilterValue = isNaN(d.getTime()) ? null : d.getTime();
            } else {
              numFilterValue = parseFloat(filterRaw.replace(/,/g, ''));
            }

            if (numFilterValue !== null && !isNaN(numFilterValue)) {
              var match = false;
              if (operator === '>=') match = numCellValue >= numFilterValue;
              else if (operator === '<=') match = numCellValue <= numFilterValue;
              else if (operator === '>') match = numCellValue > numFilterValue;
              else if (operator === '<') match = numCellValue < numFilterValue;
              else if (operator === '=') match = numCellValue === numFilterValue;
              else {
                match = (numCellValue === numFilterValue) || td.textContent.toLowerCase().includes(filterValue.toLowerCase());
              }
              
              if (!match) {
                display = "none";
                break;
              }
            } else {
              if (td.textContent.trim().toLowerCase().indexOf(filterValue.toLowerCase()) === -1) {
                display = "none";
                break;
              }
            }
          }
        } else {
          var textValue = (cellValue !== null && cellValue !== "" ? cellValue : td.textContent).trim();
          if (textValue.toLowerCase().indexOf(filterValue.toLowerCase()) === -1 &&
              td.textContent.toLowerCase().indexOf(filterValue.toLowerCase()) === -1) {
            display = "none";
            break;
          }
        }
      }
    }
    tr[i].style.display = display;
    if (display === "") visibleCount++;
  }
  document.getElementById("visibleCount").textContent = visibleCount;
}

var activeQuickFilter = "";

function setQuickFilter(filterType) {
  activeQuickFilter = filterType || "";
  var inputs = document.querySelectorAll("thead .filter-input");
  for (var i = 0; i < inputs.length; i++) {
    var col = inputs[i].getAttribute("data-col");
    if (!filterType) {
      inputs[i].value = "";
    } else if (col === "4") {
      if (["Rightmove", "JLL", "JOHNS&CO", "Knight Frank"].includes(filterType)) {
        if (filterType === "Knight Frank") inputs[i].value = "Knight";
        else if (filterType === "JOHNS&CO") inputs[i].value = "Johns";
        else inputs[i].value = filterType;
      } else {
        inputs[i].value = "";
      }
    } else if (col === "5") {
      if (filterType === "OpenRent") {
        inputs[i].value = "OpenRent";
      } else {
        inputs[i].value = "";
      }
    }
  }
  filterTable();
  var chips = document.querySelectorAll(".quick-filters .filter-chip");
  if (chips.length > 0) {
    for (var k = 0; k < chips.length; k++) chips[k].classList.remove("active");
    if (!filterType) {
      var allBtn = document.getElementById("chipAll");
      if (allBtn) allBtn.classList.add("active");
    } else if (filterType === "Rightmove") {
      var rmBtn = document.getElementById("chipRightmove");
      if (rmBtn) rmBtn.classList.add("active");
    } else if (filterType === "JLL") {
      var jllBtn = document.getElementById("chipJLL");
      if (jllBtn) jllBtn.classList.add("active");
    } else if (filterType === "JOHNS&CO") {
      var jcoBtn = document.getElementById("chipJohns");
      if (jcoBtn) jcoBtn.classList.add("active");
    } else if (filterType === "Knight Frank") {
      var kfBtn = document.getElementById("chipKF");
      if (kfBtn) kfBtn.classList.add("active");
    } else if (filterType === "OpenRent") {
      var orBtn = document.getElementById("chipOpenRent");
      if (orBtn) orBtn.classList.add("active");
    } else if (filterType === "EarlyBird") {
      var ebBtn = document.getElementById("chipEarlyBird");
      if (ebBtn) ebBtn.classList.add("active");
    } else if (filterType === "TargetTower") {
      var ttBtn = document.getElementById("chipTargetTower");
      if (ttBtn) ttBtn.classList.add("active");
    } else if (filterType === "Starred") {
      var stBtn = document.getElementById("chipStarred");
      if (stBtn) stBtn.classList.add("active");
    } else if (filterType === "Viewed") {
      var vBtn = document.getElementById("chipViewed");
      if (vBtn) vBtn.classList.add("active");
    } else if (filterType === "Unviewed") {
      var uvBtn = document.getElementById("chipUnviewed");
      if (uvBtn) uvBtn.classList.add("active");
    } else if (filterType === "Bargain") {
      var bgBtn = document.getElementById("chipBargain");
      if (bgBtn) bgBtn.classList.add("active");
    } else if (filterType === "GoodValue") {
      var gvBtn = document.getElementById("chipGoodValue");
      if (gvBtn) gvBtn.classList.add("active");
    } else if (filterType === "EarlyBird") {
      var ebBtn = document.getElementById("chipEarlyBird");
      if (ebBtn) ebBtn.classList.add("active");
    } else if (filterType === "ExcludeNow") {
      var enBtn = document.getElementById("chipExcludeNow");
      if (enBtn) enBtn.classList.add("active");
    } else if (filterType === "Viewing") {
      var vwBtn = document.getElementById("chipViewing");
      if (vwBtn) vwBtn.classList.add("active");
    } else if (filterType === "Contacted") {
      var ctBtn = document.getElementById("chipContacted");
      if (ctBtn) ctBtn.classList.add("active");
    } else if (filterType === "RuledOut") {
      var roBtn = document.getElementById("chipRuledOut");
      if (roBtn) roBtn.classList.add("active");
    }
  }
}

function updateCompatibilityBadges() {
  var targetDateInput = document.getElementById("targetDateInput");
  var targetDateVal = targetDateInput ? targetDateInput.value : "";
  var table = document.getElementById("matchesTable");
  if (!table) return;
  var tbody = table.getElementsByTagName("tbody")[0];
  var tr = tbody.getElementsByTagName("tr");
  var windowDays = document.getElementById("windowSelect") ? parseInt(document.getElementById("windowSelect").value, 10) : 14;
  var targetTs = targetDateVal ? new Date(targetDateVal).getTime() : 0;

  for (var i = 0; i < tr.length; i++) {
    var availTd = tr[i].getElementsByTagName("td")[3];
    if (!availTd) continue;
    var compatSpan = availTd.querySelector(".compat-indicator");
    if (!compatSpan) continue;
    
    if (!targetDateVal || targetTs === 0) {
      compatSpan.innerHTML = "";
      continue;
    }
    
    var availTs = parseFloat(availTd.getAttribute("data-value")) || 0;
    var availText = availTd.textContent.toLowerCase();
    var isNow = (availText.indexOf("now") !== -1 || availText.indexOf("immediate") !== -1 || availText.indexOf("today") !== -1);
    var isUnknown = !isNow && (availTs === 0 || availText.indexOf("unknown") !== -1 || availText.indexOf("ask agent") !== -1);
    
    if (isNow) {
      compatSpan.innerHTML = '<br><span class="compat-tag compat-imm">⚪ Immediate / Negotiable</span>';
    } else if (isUnknown) {
      compatSpan.innerHTML = '<br><span class="compat-tag compat-ask-agent">❓ Ask Agent / Unknown</span>';
    } else if (availTs > 0) {
      var diffDays = (availTs - targetTs) / (1000 * 60 * 60 * 24);
      if ((windowDays === 999 && diffDays <= 0) || (windowDays !== 999 && windowDays !== 3650 && Math.abs(diffDays) <= windowDays) || windowDays === 3650) {
        compatSpan.innerHTML = '<br><span class="compat-tag compat-spot-on">🟢 Spot On (' + (Math.round(diffDays) >= 0 ? '+' : '') + Math.round(diffDays) + 'd)</span>';
      } else if (diffDays < 0) {
        compatSpan.innerHTML = '<br><span class="compat-tag compat-early">🟡 Early (' + Math.abs(Math.round(diffDays)) + 'd prior)</span>';
      } else {
        compatSpan.innerHTML = '<br><span class="compat-tag compat-advance">🔵 Advance (' + Math.round(diffDays) + 'd later)</span>';
      }
    }
  }
}

function applyMoveInFilter() {
  var compatSelect = document.getElementById("compatLabelSelect");
  var targetInput = document.getElementById("targetDateInput");
  if (compatSelect && compatSelect.value && targetInput && !targetInput.value) {
    targetInput.value = new Date().toISOString().slice(0, 10);
  }
  updateCompatibilityBadges();
  filterTable();
}

function clearMoveInAssistant() {
  var targetInput = document.getElementById("targetDateInput");
  if (targetInput) targetInput.value = "";
  var winSelect = document.getElementById("windowSelect");
  if (winSelect) winSelect.value = "14";
  var compatSelect = document.getElementById("compatLabelSelect");
  if (compatSelect) compatSelect.value = "";
  var incUnk = document.getElementById("includeUnknownCheck");
  if (incUnk) incUnk.checked = true;
  updateCompatibilityBadges();
  filterTable();
}

function sortByTargetDate() {
  var targetInput = document.getElementById("targetDateInput");
  var targetDateVal = targetInput ? targetInput.value : "";
  if (!targetDateVal) {
    var todayStr = new Date().toISOString().slice(0, 10);
    if (targetInput) targetInput.value = todayStr;
    targetDateVal = todayStr;
    updateCompatibilityBadges();
    filterTable();
  }
  var targetTs = new Date(targetDateVal).getTime();
  currentSorts = [{col: 'target', targetTs: targetTs}];
  applySort();
  updateSortIndicators();
  var sortBtns = document.querySelectorAll(".quick-sorts .filter-chip");
  for (var i = 0; i < sortBtns.length; i++) sortBtns[i].classList.remove("active");
  var btn = document.getElementById("sortTargetDate");
  if (btn) btn.classList.add("active");
}

var currentSorts = []; // Default: no client-side column sort override; keep original generation order

function sortTable(n, event) {
  var isShift = event && event.shiftKey;
  
  if (isShift && currentSorts.length > 0) {
    var foundIdx = -1;
    for (var j = 0; j < currentSorts.length; j++) {
      if (currentSorts[j].col === n) { foundIdx = j; break; }
    }
    if (foundIdx !== -1) {
      currentSorts[foundIdx].dir = currentSorts[foundIdx].dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSorts.push({col: n, dir: (n === 0 || n === 1 || n === 3 || n === 8) ? 'desc' : 'asc'});
    }
  } else {
    var primaryDir = 'asc';
    if (currentSorts.length > 0 && currentSorts[0].col === n) {
      primaryDir = currentSorts[0].dir === 'asc' ? 'desc' : 'asc';
    } else {
      primaryDir = (n === 0 || n === 1 || n === 3 || n === 8) ? 'desc' : 'asc';
    }

    if (n === 0) {
      currentSorts = [{col: 0, dir: primaryDir}, {col: 8, dir: 'asc'}];
    } else if (n === 8) {
      currentSorts = [{col: 8, dir: primaryDir}, {col: 9, dir: 'desc'}];
    } else if (n === 9) {
      currentSorts = [{col: 9, dir: primaryDir}, {col: 8, dir: 'asc'}];
    } else {
      currentSorts = [{col: n, dir: primaryDir}, {col: 8, dir: 'asc'}];
    }
  }

  applySort();
  updateSortIndicators();
}

function applySort() {
  var table = document.getElementById("matchesTable");
  if (!table) return;
  var tbody = table.getElementsByTagName("tbody")[0];
  var rows = Array.from(tbody.getElementsByTagName("tr"));

  rows.sort(function(rowA, rowB) {
    if (currentSorts.length === 0) {
      var idxA = parseInt(rowA.getAttribute("data-index") || "0", 10);
      var idxB = parseInt(rowB.getAttribute("data-index") || "0", 10);
      return idxA - idxB;
    }
    for (var k = 0; k < currentSorts.length; k++) {
      var colIdx = currentSorts[k].col;
      var dir = currentSorts[k].dir;

      if (colIdx === 'target') {
        var tTs = currentSorts[k].targetTs;
        var getDist = function(row) {
          var td = row.getElementsByTagName("td")[3];
          if (!td) return 9999999999999;
          var ts = parseFloat(td.getAttribute("data-value")) || 0;
          var text = td.textContent.toLowerCase();
          if (ts > 0) return Math.abs(ts - tTs);
          if (text.indexOf("now") !== -1 || text.indexOf("immediate") !== -1 || text.indexOf("today") !== -1) return Math.abs(Date.now() - tTs);
          return 9999999999999;
        };
        var distA = getDist(rowA);
        var distB = getDist(rowB);
        if (distA !== distB) {
          if (dir === 'desc') return distB - distA;
          return distA - distB;
        }
        continue;
      }

      var cellA = rowA.getElementsByTagName("td")[colIdx];
      var cellB = rowB.getElementsByTagName("td")[colIdx];
      if (!cellA || !cellB) continue;

      var valA = cellA.getAttribute("data-value") !== null && cellA.getAttribute("data-value") !== "" ? cellA.getAttribute("data-value") : cellA.textContent.toLowerCase().trim();
      var valB = cellB.getAttribute("data-value") !== null && cellB.getAttribute("data-value") !== "" ? cellB.getAttribute("data-value") : cellB.textContent.toLowerCase().trim();

      var isNumericCol = (colIdx === 0 || colIdx === 1 || colIdx === 3 || colIdx === 8 || colIdx === 9 || colIdx === 10);
      if (isNumericCol) {
        var nA = parseFloat(valA);
        var nB = parseFloat(valB);
        if (isNaN(nA)) nA = dir === 'asc' ? Infinity : -Infinity;
        if (isNaN(nB)) nB = dir === 'asc' ? Infinity : -Infinity;
        if (nA !== nB) {
          if (dir === 'asc') return nA - nB;
          return nB - nA;
        }
      } else {
        var sA = String(valA).toLowerCase();
        var sB = String(valB).toLowerCase();
        if (sA !== sB) {
          if (dir === 'asc') return sA.localeCompare(sB);
          return sB.localeCompare(sA);
        }
      }
    }
    return 0;
  });

  var fragment = document.createDocumentFragment();
  for (var r = 0; r < rows.length; r++) {
    fragment.appendChild(rows[r]);
  }
  tbody.appendChild(fragment);
}

function updateSortIndicators() {
  for (var c = 0; c <= 10; c++) {
    var ind = document.getElementById("sort-ind-" + c);
    if (ind) ind.textContent = "";
  }
  for (var j = 0; j < currentSorts.length; j++) {
    var col = currentSorts[j].col;
    var dir = currentSorts[j].dir;
    var arrow = dir === 'asc' ? '▲' : '▼';
    var indEl = document.getElementById("sort-ind-" + col);
    if (indEl) {
      indEl.textContent = currentSorts.length > 1 ? (arrow + " (" + (j + 1) + ")") : arrow;
    }
  }
}

function setMultiSort(criteria) {
  currentSorts = criteria;
  applySort();
  updateSortIndicators();
  
  var sortBtns = document.querySelectorAll(".quick-sorts .filter-chip");
  for (var i = 0; i < sortBtns.length; i++) sortBtns[i].classList.remove("active");
  
  if (criteria.length === 2 && criteria[0].col === 0 && criteria[1].col === 8) {
    var btn = document.getElementById("sortDatePrice");
    if (btn) btn.classList.add("active");
  }
}

function clearSort() {
  activeQuickFilter = "";
  var globalSearch = document.getElementById("globalSearch");
  if (globalSearch) globalSearch.value = "";
  var compatSelect = document.getElementById("compatLabelSelect");
  if (compatSelect) compatSelect.value = "";
  var inputs = document.querySelectorAll("thead .filter-input");
  for (var i = 0; i < inputs.length; i++) inputs[i].value = "";
  var chips = document.querySelectorAll(".quick-actions-bar .filter-chip, .quick-filters .filter-chip");
  for (var k = 0; k < chips.length; k++) chips[k].classList.remove("active");
  var allBtn = document.getElementById("chipAll");
  if (allBtn) allBtn.classList.add("active");
  filterTable();

  setMultiSort([]);
  var clearBtn = document.getElementById("clearSortBtn");
  if (clearBtn) {
    clearBtn.classList.add("active");
    setTimeout(() => clearBtn.classList.remove("active"), 1200);
  }
}

function applySavedCrmData() {
  const statuses = JSON.parse(localStorage.getItem('crm_statuses') || '{}');
  const notes = JSON.parse(localStorage.getItem('crm_notes') || '{}');
  const rows = document.querySelectorAll("#matchesTable tbody tr");
  rows.forEach(tr => {
    const id = tr.getAttribute("data-id");
    if (statuses[id]) {
      tr.setAttribute("data-crm-status", statuses[id]);
      const select = tr.querySelector(".crm-status-select");
      if (select) select.value = statuses[id];
      if (statuses[id] === "ruledout") tr.classList.add("row-ruledout");
      else tr.classList.remove("row-ruledout");
    }
    const btn = tr.querySelector('#note-btn-' + id);
    if (btn) {
      if (notes[id]) {
        btn.classList.add('has-note');
        btn.title = 'Note: ' + notes[id];
      } else {
        btn.classList.remove('has-note');
        btn.title = 'Add / View Note';
      }
    }
  });
}

function updateRowStatus(id, newStatus) {
  const statuses = JSON.parse(localStorage.getItem('crm_statuses') || '{}');
  statuses[id] = newStatus;
  localStorage.setItem('crm_statuses', JSON.stringify(statuses));
  const tr = document.querySelector('tr[data-id="' + id + '"]');
  if (tr) {
    tr.setAttribute('data-crm-status', newStatus);
    if (newStatus === 'ruledout') tr.classList.add('row-ruledout');
    else tr.classList.remove('row-ruledout');
  }
  filterTable();
}

let currentEditingNoteId = null;
function openNoteModal(id) {
  currentEditingNoteId = id;
  const notes = JSON.parse(localStorage.getItem('crm_notes') || '{}');
  const textarea = document.getElementById('noteTextarea');
  if (textarea) textarea.value = notes[id] || '';
  const modal = document.getElementById('noteModal');
  if (modal) modal.style.display = 'flex';
}
function closeNoteModal() {
  const modal = document.getElementById('noteModal');
  if (modal) modal.style.display = 'none';
}
function saveNoteFromModal() {
  if (!currentEditingNoteId) return;
  const textarea = document.getElementById('noteTextarea');
  const noteVal = textarea ? textarea.value.trim() : '';
  const notes = JSON.parse(localStorage.getItem('crm_notes') || '{}');
  if (noteVal) notes[currentEditingNoteId] = noteVal;
  else delete notes[currentEditingNoteId];
  localStorage.setItem('crm_notes', JSON.stringify(notes));
  const tr = document.querySelector('tr[data-id="' + currentEditingNoteId + '"]');
  if (tr) {
    const btn = tr.querySelector('#note-btn-' + currentEditingNoteId);
    if (btn) {
      if (noteVal) {
        btn.classList.add('has-note');
        btn.title = 'Note: ' + noteVal;
      } else {
        btn.classList.remove('has-note');
        btn.title = 'Add / View Note';
      }
    }
  }
  closeNoteModal();
}

function copyShortlistToClipboard() {
  const starred = getStarredIds();
  if (starred.length === 0) {
    alert('No properties starred yet! Click ⭐ on properties to add them to your shortlist first.');
    return;
  }
  const rows = document.querySelectorAll('#matchesTable tbody tr');
  let summary = '🌟 MY LONDON PROPERTY SHORTLIST (' + starred.length + ' properties) 🌟\\n\\n';
  let count = 1;
  rows.forEach(tr => {
    const id = tr.getAttribute('data-id');
    if (starred.includes(id)) {
      const price = tr.children[8].textContent.trim();
      const sqm = tr.children[9].textContent.trim();
      const ppsqmText = tr.children[10].textContent.replace(/💎.*|👍.*|⚖️.*/g, '').trim();
      const propName = tr.children[7].textContent.trim();
      const loc = tr.children[6].textContent.trim();
      const platform = tr.getAttribute('data-platform') || 'Rightmove';
      const agent = tr.children[5].textContent.trim();
      const avail = tr.children[3].querySelector('.avail-text') ? tr.children[3].querySelector('.avail-text').textContent : tr.children[3].textContent.trim();
      const linkEl = tr.children[12].querySelector('a');
      const url = linkEl ? linkEl.href : '';

      summary += count + '. ' + propName + ' — ' + price + ' (' + sqm + ' | ' + ppsqmText + ')\\n';
      summary += '   📍 ' + loc + ' | ' + platform + ' (' + agent + ')\\n';
      summary += '   📅 Let Available: ' + avail + '\\n';
      summary += '   🔗 ' + url + '\\n\\n';
      count++;
    }
  });
  if (navigator.clipboard) {
    navigator.clipboard.writeText(summary).then(() => {
      alert('✅ Copied ' + starred.length + ' shortlisted properties to clipboard!');
    });
  } else {
    alert(summary);
  }
}
document.addEventListener("DOMContentLoaded", function() {
  applyStarred();
  applySeen();
  applySavedCrmData();
  applySort();
  updateSortIndicators();
  updateCompatibilityBadges();
});
</script>
</head>
<body>
<div class="header-container">
  <div class="title-area">
    <h2>Property Matches</h2>
    <div class="stats">
      Showing <span id="visibleCount">${result.length}</span> of ${result.length} properties found
      <button id="resetStarredBtn" onclick="resetStarred()" style="display:none;">Clear Saved (<span id="starredCount">0</span>)</button>
      <button id="resetSeenBtn" onclick="resetSeen()" style="display:none;">Reset Viewed (<span id="seenCount">0</span>)</button>
    </div>
  </div>
  <div class="move-in-assistant" id="moveInAssistant">
    <div class="assistant-header">
      <span class="assistant-icon">🎯</span>
      <span class="assistant-title">Let Available Date Assistant</span>
      <span class="assistant-subtitle">Filter deals tailored to your desired let available date</span>
    </div>
    <div class="assistant-controls">
      <div class="control-group">
        <label for="targetDateInput">Target Let Available:</label>
        <input type="date" id="targetDateInput" value="${flags.targetDate || ''}" onchange="applyMoveInFilter()">
      </div>
      <div class="control-group">
        <label for="windowSelect">Tolerance:</label>
        <select id="windowSelect" onchange="applyMoveInFilter()">
          <option value="7" ${(flags.window === 7 || !flags.window) ? 'selected' : ''}>± 7 days</option>
          <option value="14" ${flags.window === 14 ? 'selected' : ''}>± 14 days</option>
          <option value="30" ${flags.window === 30 ? 'selected' : ''}>± 30 days</option>
          <option value="999" ${flags.window === 999 ? 'selected' : ''}>Any time before</option>
          <option value="3650" ${flags.window === 3650 ? 'selected' : ''}>Any date (All)</option>
        </select>
      </div>
      <div class="control-group">
        <label for="compatLabelSelect">Match Label:</label>
        <select id="compatLabelSelect" onchange="applyMoveInFilter()">
          <option value="">All Labels</option>
          <option value="spot-on">🟢 Spot On Only</option>
          <option value="early">🟡 Early Only</option>
          <option value="advance">🔵 Advance Only</option>
          <option value="imm">⚪ Immediate / Negotiable</option>
          <option value="ask-agent">❓ Ask Agent / Unknown</option>
        </select>
      </div>
      <div class="control-group checkbox-group">
        <label class="toggle-check"><input type="checkbox" id="includeUnknownCheck" ${flags.includeUnknownAvailability ? 'checked' : ''} onchange="applyMoveInFilter()"> <span>Include "Ask Agent / Any"</span></label>
      </div>
      <button id="clearMoveInBtn" class="filter-chip chip-clear-movein" onclick="clearMoveInAssistant()">Reset Date</button>
    </div>
  </div>
  <div class="quick-actions-bar">
    <div class="quick-filters action-group">
      <span class="filter-label">Quick Filters:</span>
      <button id="chipAll" class="filter-chip active" onclick="setQuickFilter('')">All</button>
      <button id="chipBargain" class="filter-chip chip-bargain" onclick="setQuickFilter('Bargain')">💎 Bargain</button>
      <button id="chipGoodValue" class="filter-chip chip-goodvalue" onclick="setQuickFilter('GoodValue')">👍 Good Value</button>
      <button id="chipTargetTower" class="filter-chip chip-targettower" onclick="setQuickFilter('TargetTower')">🏛️ Target Towers</button>
      <button id="chipEarlyBird" class="filter-chip chip-earlybird" onclick="setQuickFilter('EarlyBird')">🦅 Early Bird</button>
      <button id="chipExcludeNow" class="filter-chip chip-excludenow" onclick="setQuickFilter('ExcludeNow')">🚫 Exclude Now</button>
      <button id="chipViewed" class="filter-chip chip-viewed" onclick="setQuickFilter('Viewed')">✓ Viewed</button>
      <button id="chipUnviewed" class="filter-chip chip-unviewed" onclick="setQuickFilter('Unviewed')">👀 Unviewed</button>
      <button id="chipStarred" class="filter-chip chip-starred" onclick="setQuickFilter('Starred')">⭐ Starred (<span id="starredCount">0</span>)</button>
    </div>
    <div class="action-divider"></div>
    <div class="quick-sorts action-group">
      <span class="filter-label">Quick Sort:</span>
      <button id="sortDatePrice" class="filter-chip" onclick="setMultiSort([{col: 0, dir: 'desc'}, {col: 8, dir: 'asc'}])">📅 Date → Price</button>
      <button id="sortTargetDate" class="filter-chip chip-target" onclick="sortByTargetDate()">🎯 Match Proximity</button>
      <button id="clearSortBtn" class="filter-chip chip-clear" onclick="clearSort()">✕ Clear All</button>
      <div class="tooltip-container">
        <span class="tooltip-badge">ℹ️ Multi-Sort</span>
        <div class="tooltip-popup">
          <strong>⚡ Multi-Column Sorting Guide:</strong><br>
          • <strong>Hold SHIFT + Click</strong> any column header to add it as a secondary (2), tertiary (3), etc. sort column.<br>
          • <strong>Normal Click</strong> sets a smart 2-column default (e.g. Date then Price).<br>
          • Click <strong>✕ Clear All</strong> to clear all filters and remove sorting.
        </div>
      </div>
    </div>
  </div>
  <div class="search-container">
    <label for="globalSearch">Quick Search</label>
    <input type="text" id="globalSearch" onkeyup="filterTable()" placeholder="Search location, agent...">
  </div>
</div>

<div class="table-wrapper">
<table id="matchesTable">
  <thead>
    <tr>
      <th onclick="sortTable(0, event)">Date <span class="sort-indicator" id="sort-ind-0"></span><br><input type="text" class="filter-input" data-col="0" data-type="date" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Date (e.g. >2026-05-01)..."></th>
      <th onclick="sortTable(1, event)">Listed / Updated <span class="sort-indicator" id="sort-ind-1"></span><br><input type="text" class="filter-input" data-col="1" data-type="date" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Date (e.g. >2026-07-01)..."></th>
      <th onclick="sortTable(2, event)">Status <span class="sort-indicator" id="sort-ind-2"></span><br><input type="text" class="filter-input" data-col="2" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter (e.g. yesterday)..."></th>
      <th onclick="sortTable(3, event)">Let Available <span class="sort-indicator" id="sort-ind-3"></span><br><input type="text" class="filter-input" data-col="3" data-type="date" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Date (e.g. >2026-07-01)..."></th>
      <th onclick="sortTable(4, event)">Source <span class="sort-indicator" id="sort-ind-4"></span><br><input type="text" class="filter-input" data-col="4" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Source (e.g. Rightmove, JLL)..."></th>
      <th onclick="sortTable(5, event)">Marketed By <span class="sort-indicator" id="sort-ind-5"></span><br><input type="text" class="filter-input" data-col="5" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter (e.g. OpenRent)..."></th>
      <th onclick="sortTable(6, event)">Location <span class="sort-indicator" id="sort-ind-6"></span><br><input type="text" class="filter-input" data-col="6" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(7, event)">Property Name <span class="sort-indicator" id="sort-ind-7"></span><br><input type="text" class="filter-input" data-col="7" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter (e.g. Landmark)..."></th>
      <th onclick="sortTable(8, event)">Price <span class="sort-indicator" id="sort-ind-8"></span><br><input type="text" class="filter-input" data-col="8" data-type="numeric" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Price (e.g. >2000)..."></th>
      <th onclick="sortTable(9, event)">Size <span class="sort-indicator" id="sort-ind-9"></span><br><input type="text" class="filter-input" data-col="9" data-type="numeric" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Size (e.g. <50)..."></th>
      <th onclick="sortTable(10, event)">£ / sqm <span class="sort-indicator" id="sort-ind-10"></span><br><input type="text" class="filter-input" data-col="10" data-type="numeric" oninput="filterTable()" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="£/sqm (e.g. >=40)..."></th>
      <th style="cursor: default; text-align: center; width: 40px;" title="Personal Notes">📝</th>
      <th style="cursor: default; text-align: center;">Link</th>
      <th style="cursor: default; text-align: center;">⭐</th>
    </tr>
  </thead>
  <tbody>
${htmlRows}
  </tbody>
</table>
</div>

<div id="noteModal" class="modal-overlay" style="display: none;" onclick="if(event.target===this) closeNoteModal()">
  <div class="modal-card">
    <h3>📝 Personal Note for Property</h3>
    <textarea id="noteTextarea" placeholder="e.g. Viewing booked Sat 2pm with Sarah. Loved the balcony!..." rows="4"></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeNoteModal()">Cancel</button>
      <button class="btn-save" onclick="saveNoteFromModal()">Save Note</button>
    </div>
  </div>
</div>

</body>
</html>`;
      fs.writeFileSync(htmlFile, htmlContent);
      fs.writeFileSync(path.join(__dirname, 'index.html'), htmlContent);
      console.log(`Updated ${htmlFile} and root index.html with ${result.length} matches.`);
    }

    if (flags.migrate && fs.existsSync(TXT_FILE)) {
      const backupPath = TXT_FILE + '.bak';
      fs.renameSync(TXT_FILE, backupPath);
      console.log(`Migrated and backed up ${TXT_FILE} to ${backupPath}`);
    }
  }
}

main().catch(err => {
  console.error('Error running tidy_data.js:', err);
  process.exit(1);
});

