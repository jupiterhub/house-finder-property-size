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
      matches.push(match);
    }
  }

  return matches;
}

function formatMatchMarkdown(match) {
  return `### [${match.timestamp.toISOString()}] MATCH FOUND!\n` +
    `- **Platform**: ${match.platform}\n` +
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
    seen = { "Rightmove": seen, "Zoopla": [] };
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
  
  const rightmoveMatches = matches.filter(m => m.platform === 'Rightmove');
  const zooplaMatches = matches.filter(m => m.platform === 'Zoopla');

  console.log(`Rightmove matches to check: ${rightmoveMatches.length}`);
  console.log(`Zoopla matches to check: ${zooplaMatches.length}`);

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

  // Zoopla checking (Playwright)
  if (zooplaMatches.length > 0) {
    console.log('\n--- VERIFYING ZOOPLA (Playwright) ---');
    try {
      const { chromium } = require('playwright-extra');
      const stealth = require('puppeteer-extra-plugin-stealth')();
      chromium.use(stealth);

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      for (let i = 0; i < zooplaMatches.length; i++) {
        const item = zooplaMatches[i];
        console.log(`Verifying Zoopla ${i + 1}/${zooplaMatches.length}: ${item.link}...`);
        
        try {
          const response = await page.goto(item.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const currentUrl = page.url();

          // Check if redirected to search or another page (means listing is gone)
          if (currentUrl !== item.link && !currentUrl.includes(item.id)) {
            console.log(`- Zoopla Property ${item.id} is off-market (Redirected)`);
            continue;
          }

          if (response.status() === 404 || response.status() === 410) {
            console.log(`- Zoopla Property ${item.id} is off-market (Status ${response.status()})`);
            continue;
          }

          const bodyText = await page.innerText('body');
          const isLetAgreed = /let agreed/i.test(bodyText);
          const isNoLongerMarket = /no longer on the market/i.test(bodyText) || 
                                   /no longer listed/i.test(bodyText);

          if (isLetAgreed) {
            console.log(`- Zoopla Property ${item.id} is Let Agreed`);
          } else if (isNoLongerMarket) {
            console.log(`- Zoopla Property ${item.id} is no longer on the market`);
          } else {
            results.push(item);
          }
        } catch (err) {
          results.push(item);
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      await browser.close();
    } catch (err) {
      console.error('Playwright verification failed for Zoopla, preserving listings:', err.message);
      for (const item of zooplaMatches) {
        results.push(item);
      }
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

    let valA = a[flags.sort];
    let valB = b[flags.sort];

    if (flags.sort === 'date' || flags.sort === 'timestamp') {
      valA = a.timestamp;
      valB = b.timestamp;
    }

    if (flags.order === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  });

  const outputContent = result.map(formatMatchMarkdown).join('');

  const targetFile = flags.output || MD_FILE;
  
  if (flags.migrate || args.length >= 0) {
    fs.writeFileSync(targetFile, outputContent);
    console.log(`Updated ${targetFile} with ${result.length} matches (sorted by ${flags.sort} ${flags.order}).`);
    
    // Generate HTML
    const htmlFile = flags.output ? flags.output.replace(/\.md$/, '.html') : HTML_FILE;
    if (htmlFile !== targetFile) {
      const htmlRows = result.map(m => {
        const dateStr = m.timestamp ? m.timestamp.toISOString().replace(/T/, ' ').replace(/\..+/, '') : '';
        const timestamp = m.timestamp ? m.timestamp.getTime() : 0;
        const pricePerSqm = (m.price && m.size) ? (m.price / m.size).toFixed(2) : 'N/A';
        const pricePerSqmValue = (m.price && m.size) ? (m.price / m.size) : 0;
        const badgeClass = m.platform.toLowerCase() === 'rightmove' ? 'badge-rightmove' : 'badge-zoopla';
        
        return `<tr data-id="${m.id}">
          <td data-value="${timestamp}">${dateStr}</td>
          <td><span class="badge ${badgeClass}">${m.platform}</span></td>
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
    --zoopla: #ff0050;
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
  .badge-zoopla {
    background: rgba(255, 0, 80, 0.15);
    color: var(--zoopla);
    border: 1px solid rgba(255, 0, 80, 0.3);
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

function sortTable(n) {
  var table, rows, switching, i, x, y, shouldSwitch, dir, switchcount = 0;
  table = document.getElementById("matchesTable");
  switching = true;
  dir = "asc";
  while (switching) {
    switching = false;
    rows = table.getElementsByTagName("tbody")[0].rows;
    for (i = 0; i < (rows.length - 1); i++) {
      shouldSwitch = false;
      x = rows[i].getElementsByTagName("TD")[n];
      y = rows[i + 1].getElementsByTagName("TD")[n];
      
      var valX = x.getAttribute("data-value") || x.textContent.toLowerCase().trim();
      var valY = y.getAttribute("data-value") || y.textContent.toLowerCase().trim();
      
      var numX = parseFloat(valX);
      var numY = parseFloat(valY);
      
      if (!isNaN(numX) && !isNaN(numY)) {
        valX = numX;
        valY = numY;
      }

      if (dir == "asc") {
        if (valX > valY) { shouldSwitch = true; break; }
      } else if (dir == "desc") {
        if (valX < valY) { shouldSwitch = true; break; }
      }
    }
    if (shouldSwitch) {
      rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
      switching = true;
      switchcount ++;
    } else {
      if (switchcount == 0 && dir == "asc") {
        dir = "desc";
        switching = true;
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applyHidden();
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
  <div class="search-container">
    <label for="globalSearch">Quick Search</label>
    <input type="text" id="globalSearch" onkeyup="filterTable()" placeholder="Search location, platform, dates...">
  </div>
</div>

<div class="table-wrapper">
<table id="matchesTable">
  <thead>
    <tr>
      <th onclick="sortTable(0)">Date ↕<br><input type="text" class="filter-input" data-col="0" data-type="date" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Date (e.g. >2026-05-01)..."></th>
      <th onclick="sortTable(1)">Platform ↕<br><input type="text" class="filter-input" data-col="1" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(2)">Location ↕<br><input type="text" class="filter-input" data-col="2" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(3)">Price ↕<br><input type="text" class="filter-input" data-col="3" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Price (e.g. >2000)..."></th>
      <th onclick="sortTable(4)">Size ↕<br><input type="text" class="filter-input" data-col="4" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Size (e.g. <50)..."></th>
      <th onclick="sortTable(5)">£ / sqm ↕<br><input type="text" class="filter-input" data-col="5" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="£/sqm (e.g. >=40)..."></th>
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

