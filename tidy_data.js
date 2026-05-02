const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TXT_FILE = path.join(DATA_DIR, 'matches.txt');
const MD_FILE = path.join(DATA_DIR, 'matches.md');
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
    `- **ID**: ${match.id}\n` +
    `- **Price**: £${match.price} PCM\n` +
    `- **Size**: ${match.size} sqm\n` +
    `- **Link**: [${match.link}](${match.link})\n\n` +
    `---\n\n`;
}

function tidySeenProperties() {
  if (!fs.existsSync(SEEN_FILE)) return;
  
  let seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
  const originalCount = seen.length;
  
  // Deduplicate and sort
  seen = [...new Set(seen)].sort((a, b) => a.localeCompare(b));
  
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  console.log(`Tidied seen_properties.json: Removed ${originalCount - seen.length} duplicates and sorted ${seen.length} IDs.`);
}

function main() {
  const args = process.argv.slice(2);
  const flags = {
    maxPrice: null,
    sort: 'timestamp',
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

  // Deduplicate by ID
  const uniqueMatches = [];
  const seenIds = new Set();
  for (const m of allMatches) {
    if (!seenIds.has(m.id)) {
      uniqueMatches.push(m);
      seenIds.add(m.id);
    }
  }

  let result = uniqueMatches;

  // Filter
  if (flags.maxPrice) {
    result = result.filter(m => m.price <= flags.maxPrice);
  }

  // Sort
  result.sort((a, b) => {
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

  if (flags.migrate || (args.length === 0 && !flags.cleanSeen)) {
    // Default behavior or explicit migrate: write to matches.md and potentially archive old txt
    fs.writeFileSync(MD_FILE, outputContent);
    console.log(`Updated ${MD_FILE} with ${result.length} matches.`);
    
    if (flags.migrate && fs.existsSync(TXT_FILE)) {
      const backupPath = TXT_FILE + '.bak';
      fs.renameSync(TXT_FILE, backupPath);
      console.log(`Migrated and backed up ${TXT_FILE} to ${backupPath}`);
    }
  } else if (flags.output) {
    fs.writeFileSync(flags.output, outputContent);
    console.log(`Saved ${result.length} filtered/sorted matches to ${flags.output}`);
  } else {
    console.log(outputContent);
  }
}

main();
