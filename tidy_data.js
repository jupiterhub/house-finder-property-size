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

function main() {
  const args = process.argv.slice(2);
  const flags = {
    maxPrice: null,
    sort: 'ideal',
    order: 'desc',
    output: null,
    cleanSeen: false,
    migrate: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-price') flags.maxPrice = parseFloat(args[++i]);
    else if (args[i] === '--sort') flags.sort = args[++i];
    else if (args[i] === '--order') flags.order = args[++i];
    else if (args[i] === '--output') flags.output = args[++i];
    else if (args[i] === '--clean-seen') flags.cleanSeen = true;
    else if (args[i] === '--migrate') flags.migrate = true;
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
        const pricePerSqm = (m.price && m.size) ? (m.price / m.size).toFixed(2) : 'N/A';
        const pricePerSqmValue = (m.price && m.size) ? (m.price / m.size) : 0;
        
        return `<tr>
          <td>${dateStr}</td>
          <td>${m.platform}</td>
          <td>${m.location || 'Unknown'}</td>
          <td class="numeric" data-value="${m.price || 0}">£${m.price || 0}</td>
          <td class="numeric" data-value="${m.size || 0}">${m.size || 0}</td>
          <td class="numeric" data-value="${pricePerSqmValue}">${pricePerSqm}</td>
          <td style="text-align: center;"><a href="${m.link}" target="_blank" class="view-btn">View</a></td>
        </tr>`;
      }).join('\n');

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
<title>Property Matches</title>
<style>
  :root {
    --primary: #007bff;
    --bg: #f8f9fa;
    --text: #333;
    --border: #dee2e6;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: var(--bg); color: var(--text); line-height: 1.5; }
  .header-container { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; flex-wrap: wrap; gap: 20px; }
  .title-area h2 { margin: 0; color: #212529; }
  .stats { color: #6c757d; font-size: 0.9em; margin-top: 5px; }
  .search-container { flex-grow: 1; max-width: 400px; }
  .search-container label { display: block; font-size: 0.8em; font-weight: 600; margin-bottom: 5px; color: #495057; }
  #globalSearch { width: 100%; padding: 10px 15px; border: 1px solid #ced4da; border-radius: 6px; box-sizing: border-box; font-size: 1rem; transition: border-color 0.2s, box-shadow 0.2s; }
  #globalSearch:focus { border-color: #80bdff; outline: 0; box-shadow: 0 0 0 0.2rem rgba(0,123,255,.25); }
  
  .table-wrapper { background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); overflow: auto; border: 1px solid var(--border); max-height: 85vh; }
  table { border-collapse: collapse; width: 100%; border-spacing: 0; }
  th { position: sticky; top: 0; background: #f1f3f5; z-index: 10; text-align: left; padding: 12px 15px; cursor: pointer; border-bottom: 2px solid var(--border); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; color: #495057; }
  th:hover { background-color: #e9ecef; }
  td { padding: 12px 15px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background-color: #f8f9fa; }
  .numeric { text-align: right; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
  
  .filter-input { width: 100%; box-sizing: border-box; font-weight: normal; margin-top: 8px; padding: 6px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.8em; }
  .view-btn { display: inline-block; padding: 6px 16px; background: var(--primary); color: white !important; text-decoration: none; border-radius: 4px; font-size: 0.85em; font-weight: 600; transition: background 0.2s; }
  .view-btn:hover { background: #0056b3; }
</style>
<script>
function filterTable() {
  var globalSearch = document.getElementById("globalSearch").value.toLowerCase();
  var table = document.getElementById("matchesTable");
  var tbody = table.getElementsByTagName("tbody")[0];
  var tr = tbody.getElementsByTagName("tr");
  var inputs = table.querySelectorAll("thead .filter-input");
  
  var visibleCount = 0;

  for (var i = 0; i < tr.length; i++) {
    var display = "";
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

        var cellValue = td.getAttribute("data-value") || td.textContent.trim();
        var isNumeric = input.getAttribute("data-type") === "numeric";

        if (isNumeric) {
          var numCellValue = parseFloat(cellValue);
          var operatorMatch = filterValue.match(/^(>=|<=|>|<)?\\s*([\\d,.]+)/);
          if (operatorMatch) {
            var operator = operatorMatch[1] || '>=';
            var numFilterValue = parseFloat(operatorMatch[2].replace(/,/g, ''));
            
            var match = false;
            if (operator === '>=') match = numCellValue >= numFilterValue;
            else if (operator === '<=') match = numCellValue <= numFilterValue;
            else if (operator === '>') match = numCellValue > numFilterValue;
            else if (operator === '<') match = numCellValue < numFilterValue;
            
            if (!match) {
              display = "none";
              break;
            }
          }
        } else {
          if (cellValue.toLowerCase().indexOf(filterValue.toLowerCase()) === -1) {
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
</script>
</head>
<body>
<div class="header-container">
  <div class="title-area">
    <h2>Property Matches</h2>
    <div class="stats">Showing <span id="visibleCount">${result.length}</span> of ${result.length} properties found</div>
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
      <th onclick="sortTable(0)">Date ↕<br><input type="text" class="filter-input" data-col="0" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(1)">Platform ↕<br><input type="text" class="filter-input" data-col="1" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(2)">Location ↕<br><input type="text" class="filter-input" data-col="2" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Filter..."></th>
      <th onclick="sortTable(3)">Price ↕<br><input type="text" class="filter-input" data-col="3" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Price (e.g. >2000)..."></th>
      <th onclick="sortTable(4)">Size (sqm) ↕<br><input type="text" class="filter-input" data-col="4" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="Size (e.g. <50)..."></th>
      <th onclick="sortTable(5)">£ / sqm ↕<br><input type="text" class="filter-input" data-col="5" data-type="numeric" onkeyup="filterTable()" onclick="event.stopPropagation()" placeholder="£/sqm (e.g. >=40)..."></th>
      <th style="cursor: default; text-align: center;">Link</th>
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

main();
