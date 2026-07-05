const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TXT_FILE = path.join(DATA_DIR, 'matches.txt');
const MD_FILE = path.join(DATA_DIR, 'matches.md');
const HTML_FILE = path.join(DATA_DIR, 'matches.html');
const SEEN_FILE = path.join(DATA_DIR, 'seen_properties.json');

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

    // Parse Marketed by (or Agent)
    const agentMatch = block.match(/(?:Marketed by:|\*\*Marketed by\*\*:|Agent:|\*\*Agent\*\*:) (.*)/);
    if (agentMatch) match.agent = agentMatch[1].trim();
    else match.agent = 'Unknown';

    // Parse Location
    const locMatch = block.match(/(?:Location:|\*\*Location\*\*:) (.*)/);
    if (locMatch) match.location = locMatch[1].trim();
    else match.location = 'Unknown';

    // Parse ID
    const idMatch = block.match(/(?:ID:|\*\*ID\*\*:) (.*)/);
    if (idMatch) match.id = idMatch[1].trim();

    // Parse Price
    const priceMatch = block.match(/(?:Price:|\*\*Price\*\*:) £?([\d,.]+)/);
    if (priceMatch) match.price = parseFloat(priceMatch[1].replace(/,/g, ''));

    // Parse Size
    const sizeMatch = block.match(/(?:Size:|\*\*Size\*\*:) ([\d,.]+) sqm/);
    if (sizeMatch) match.size = parseFloat(sizeMatch[1]);

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

function formatMatchMarkdown(match) {
  const ts = match.timestamp ? match.timestamp.toISOString() : new Date().toISOString();
  return `### [${ts}] MATCH FOUND!\n` +
    `- **Marketed by**: ${match.agent || 'Unknown'}\n` +
    `- **Location**: ${match.location || 'Unknown'}\n` +
    `- **ID**: ${match.id}\n` +
    `- **Price**: £${match.price} PCM\n` +
    `- **Size**: ${match.size} sqm\n` +
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
        results.push(item);
      }
    } catch (err) {
      // In case of error, default to keeping it in the list
      results.push(item);
    }
  }

  const removedCount = matches.length - results.length;
  console.log(`Verification complete. Removed ${removedCount} inactive/let-agreed listings.`);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {
    maxPrice: null,
    sort: 'ideal',
    order: 'desc',
    output: null,
    cleanSeen: false,
    migrate: false,
    verify: false
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
  const uniqueMatches = Array.from(uniqueMatchesMap.values());

  let result = uniqueMatches;

  // Run live verification if --verify flag is set
  if (flags.verify) {
    result = await verifyMatches(result);
  }

  // Filter
  if (flags.maxPrice) {
    result = result.filter(m => m.price <= flags.maxPrice);
  }
  if (flags.agent) {
    const query = flags.agent.toLowerCase();
    result = result.filter(m => (m.agent || 'Unknown').toLowerCase().includes(query));
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

        return `<tr data-id="${m.id}" data-index="${idx}">
          <td data-value="${timestamp}">${dateStr}</td>
          <td data-value="${agentStr}">${agentBadge}</td>
          <td>${m.location || 'Unknown'}</td>
          <td class="numeric" data-value="${m.price || 0}">£${m.price || 0}</td>
          <td class="numeric" data-value="${m.size || 0}">${m.size || 0} sqm</td>
          <td class="numeric" data-value="${pricePerSqmValue}">£${pricePerSqm}</td>
          <td style="text-align: center;"><a href="${m.link}" target="_blank" class="view-btn">View</a></td>
          <td style="text-align: center;"><button class="hide-btn" onclick="hideProperty('${m.id}')">Hide</button></td>
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
    margin-bottom: 25px;
    flex-wrap: wrap;
    gap: 20px;
    background: var(--card-bg);
    padding: 20px 25px;
    border-radius: 12px;
    border: 1px solid var(--border);
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
  .title-area h2 {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 700;
    background: linear-gradient(135deg, #60a5fa, #3b82f6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .stats {
    color: var(--text-muted);
    font-size: 0.9em;
    margin-top: 5px;
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
  .quick-filters {
    display: flex;
    align-items: center;
    gap: 10px;
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

  .hide-btn {
    display: inline-block;
    padding: 6px 14px;
    background: rgba(239, 68, 68, 0.15);
    color: var(--danger) !important;
    text-decoration: none;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .hide-btn:hover {
    background: var(--danger);
    color: white !important;
    border-color: var(--danger);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  }

  #resetHiddenBtn {
    padding: 3px 8px;
    background: rgba(148, 163, 184, 0.15);
    color: var(--text-muted);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.8em;
    transition: all 0.2s;
    margin-left: 8px;
  }
  #resetHiddenBtn:hover {
    background: #475569;
    color: white;
  }
</style>
<script>
const HIDDEN_STORAGE_KEY = 'house_finder_hidden_ids';

function getHiddenIds() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function hideProperty(id) {
  const hiddenIds = getHiddenIds();
  if (!hiddenIds.includes(id)) {
    hiddenIds.push(id);
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hiddenIds));
  }
  applyHidden();
}

function resetHidden() {
  localStorage.removeItem(HIDDEN_STORAGE_KEY);
  applyHidden();
}

function applyHidden() {
  const hiddenIds = getHiddenIds();
  const table = document.getElementById("matchesTable");
  if (!table) return;
  
  const tbody = table.getElementsByTagName("tbody")[0];
  const trs = tbody.getElementsByTagName("tr");
  
  let hiddenCount = 0;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const id = tr.getAttribute("data-id");
    if (hiddenIds.includes(id)) {
      tr.classList.add("hidden-property-row");
      tr.style.display = "none";
      hiddenCount++;
    } else {
      tr.classList.remove("hidden-property-row");
    }
  }

  const resetBtn = document.getElementById("resetHiddenBtn");
  if (resetBtn) {
    if (hiddenCount > 0) {
      resetBtn.style.display = "inline-block";
      document.getElementById("hiddenCount").textContent = hiddenCount;
    } else {
      resetBtn.style.display = "none";
    }
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
  const hiddenIds = getHiddenIds();

  for (var i = 0; i < tr.length; i++) {
    var display = "";
    var id = tr[i].getAttribute("data-id");
    
    // Local storage hide check
    if (hiddenIds.includes(id)) {
      tr[i].style.display = "none";
      continue;
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
        
        var colIndex = input.getAttribute("data-col");
        var td = tr[i].getElementsByTagName("td")[colIndex];
        if (!td) continue;

        var cellValue = td.getAttribute("data-value");
        var type = input.getAttribute("data-type");
        var isNumeric = type === "numeric";
        var isDate = type === "date";

        if (isNumeric || isDate) {
          var numCellValue = parseFloat(cellValue || td.textContent.trim());
          var operatorMatch = filterValue.match(/^(>=|<=|>|<)?\\s*(.*)/);
          var operator = operatorMatch ? (operatorMatch[1] || '>=') : '>=';
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
          var textValue = td.textContent.trim();
          if (textValue.toLowerCase().indexOf(filterValue.toLowerCase()) === -1) {
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

function setQuickFilter(agentName) {
  var inputs = document.querySelectorAll("thead .filter-input");
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i].getAttribute("data-col") === "1") {
      inputs[i].value = agentName;
      break;
    }
  }
  filterTable();
  var chips = document.querySelectorAll(".quick-filters .filter-chip");
  if (chips.length > 0) {
    for (var k = 0; k < chips.length; k++) chips[k].classList.remove("active");
    if (!agentName) {
      var allBtn = document.getElementById("chipAll");
      if (allBtn) allBtn.classList.add("active");
    } else {
      var orBtn = document.getElementById("chipOpenRent");
      if (orBtn) orBtn.classList.add("active");
    }
  }
}

var currentSorts = [{col: 0, dir: 'desc'}, {col: 3, dir: 'asc'}]; // Default: Date desc, Price asc

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
      currentSorts.push({col: n, dir: (n === 0 || n === 4) ? 'desc' : 'asc'});
    }
  } else {
    var primaryDir = 'asc';
    if (currentSorts.length > 0 && currentSorts[0].col === n) {
      primaryDir = currentSorts[0].dir === 'asc' ? 'desc' : 'asc';
    } else {
      primaryDir = (n === 0 || n === 4) ? 'desc' : 'asc';
    }

    if (n === 0) {
      currentSorts = [{col: 0, dir: primaryDir}, {col: 3, dir: 'asc'}];
    } else if (n === 3) {
      currentSorts = [{col: 3, dir: primaryDir}, {col: 4, dir: 'desc'}];
    } else if (n === 4) {
      currentSorts = [{col: 4, dir: primaryDir}, {col: 3, dir: 'asc'}];
    } else {
      currentSorts = [{col: n, dir: primaryDir}, {col: 3, dir: 'asc'}];
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

      var cellA = rowA.getElementsByTagName("td")[colIdx];
      var cellB = rowB.getElementsByTagName("td")[colIdx];
      if (!cellA || !cellB) continue;

      var valA = cellA.getAttribute("data-value") !== null && cellA.getAttribute("data-value") !== "" ? cellA.getAttribute("data-value") : cellA.textContent.toLowerCase().trim();
      var valB = cellB.getAttribute("data-value") !== null && cellB.getAttribute("data-value") !== "" ? cellB.getAttribute("data-value") : cellB.textContent.toLowerCase().trim();

      var numA = parseFloat(valA);
      var numB = parseFloat(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        valA = numA;
        valB = numB;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA !== valB) {
        if (dir === 'asc') return valA > valB ? 1 : -1;
        return valA < valB ? 1 : -1;
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
  for (var c = 0; c <= 5; c++) {
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
  
  if (criteria.length === 2 && criteria[0].col === 0 && criteria[1].col === 3) {
    var btn = document.getElementById("sortDatePrice");
    if (btn) btn.classList.add("active");
  } else if (criteria.length === 2 && criteria[0].col === 3 && criteria[1].col === 4) {
    var btn = document.getElementById("sortPriceSize");
    if (btn) btn.classList.add("active");
  } else if (criteria.length === 2 && criteria[0].col === 4 && criteria[1].col === 3) {
    var btn = document.getElementById("sortSizePrice");
    if (btn) btn.classList.add("active");
  }
}

function clearSort() {
  var globalSearch = document.getElementById("globalSearch");
  if (globalSearch) globalSearch.value = "";
  var inputs = document.querySelectorAll("thead .filter-input");
  for (var i = 0; i < inputs.length; i++) inputs[i].value = "";
  var chips = document.querySelectorAll(".quick-filters .filter-chip");
  for (var k = 0; k < chips.length; k++) chips[k].classList.remove("active");
  var allBtn = document.getElementById("chipAll");
  if (allBtn) allBtn.classList.add("active");
  filterTable();

  setMultiSort([{col: 0, dir: 'desc'}, {col: 3, dir: 'asc'}]);
  var clearBtn = document.getElementById("clearSortBtn");
  if (clearBtn) {
    clearBtn.classList.add("active");
    setTimeout(() => clearBtn.classList.remove("active"), 1200);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applySort();
  applyHidden();
  updateSortIndicators();
});
</script>
</head>
<body>
<div class="header-container">
  <div class="title-area">
    <h2>Property Matches</h2>
    <div class="stats">
      Showing <span id="visibleCount">${result.length}</span> of ${result.length} properties found
      <button id="resetHiddenBtn" onclick="resetHidden()" style="display:none;">Unhide All (<span id="hiddenCount">0</span>)</button>
    </div>
  </div>
  <div class="quick-filters">
    <span class="filter-label">Agent Filter:</span>
    <button id="chipAll" class="filter-chip active" onclick="setQuickFilter('')">All Agents</button>
    <button id="chipOpenRent" class="filter-chip chip-openrent" onclick="setQuickFilter('OpenRent')">✨ OpenRent Only</button>
  </div>
  <div class="quick-sorts">
    <span class="filter-label">Quick Sort:</span>
    <button id="sortDatePrice" class="filter-chip active" onclick="setMultiSort([{col: 0, dir: 'desc'}, {col: 3, dir: 'asc'}])">📅 Date → Price</button>
    <button id="sortPriceSize" class="filter-chip" onclick="setMultiSort([{col: 3, dir: 'asc'}, {col: 4, dir: 'desc'}])">💰 Price → Size</button>
    <button id="sortSizePrice" class="filter-chip" onclick="setMultiSort([{col: 4, dir: 'desc'}, {col: 3, dir: 'asc'}])">📐 Size → Price</button>
    <button id="clearSortBtn" class="filter-chip chip-clear" onclick="clearSort()">✕ Clear Sort / Filters</button>
    <div class="tooltip-container">
      <span class="tooltip-badge">ℹ️ How to Multi-Sort</span>
      <div class="tooltip-popup">
        <strong>⚡ Multi-Column Sorting Guide:</strong><br>
        • <strong>Hold SHIFT + Click</strong> any column header to add it as a secondary (2), tertiary (3), etc. sort column.<br>
        • <strong>Normal Click</strong> sets a smart 2-column default (e.g. Date then Price).<br>
        • Click <strong>✕ Clear Sort / Filters</strong> to clear all filters and return to default sorting (Date → Price).
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
      <th onclick="sortTable(0, event)">Date <span class="sort-indicator" id="sort-ind-0"></span><br><input type="text" class="filter-input" data-col="0" data-type="date" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Date (e.g. >2026-05-01)..."></th>
      <th onclick="sortTable(1, event)">Marketed By <span class="sort-indicator" id="sort-ind-1"></span><br><input type="text" class="filter-input" data-col="1" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter (e.g. OpenRent)..."></th>
      <th onclick="sortTable(2, event)">Location <span class="sort-indicator" id="sort-ind-2"></span><br><input type="text" class="filter-input" data-col="2" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(3, event)">Price <span class="sort-indicator" id="sort-ind-3"></span><br><input type="text" class="filter-input" data-col="3" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Price (e.g. >2000)..."></th>
      <th onclick="sortTable(4, event)">Size <span class="sort-indicator" id="sort-ind-4"></span><br><input type="text" class="filter-input" data-col="4" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Size (e.g. <50)..."></th>
      <th onclick="sortTable(5, event)">£ / sqm <span class="sort-indicator" id="sort-ind-5"></span><br><input type="text" class="filter-input" data-col="5" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="£/sqm (e.g. >=40)..."></th>
      <th style="cursor: default; text-align: center;">Link</th>
      <th style="cursor: default; text-align: center;">Actions</th>
    </tr>
  </thead>
  <tbody>
${htmlRows}
  </tbody>
</table>
</div>
</body>
</html>`;
      fs.writeFileSync(htmlFile, htmlContent);
      console.log(`Updated ${htmlFile} with ${result.length} matches.`);
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

