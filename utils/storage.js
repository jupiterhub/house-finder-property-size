const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEEN_FILE = path.join(DATA_DIR, 'seen_properties.json');
const IGNORED_FILE = path.join(DATA_DIR, 'ignored_properties.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.md');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure files exist
if (!fs.existsSync(SEEN_FILE)) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify({}));
}
if (!fs.existsSync(IGNORED_FILE)) {
  fs.writeFileSync(IGNORED_FILE, JSON.stringify({}));
}

function getSeenProperties() {
  try {
    const data = fs.readFileSync(SEEN_FILE, 'utf-8');
    let parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
        parsed = { "Rightmove": parsed, "Zoopla": [] };
    }
    return parsed;
  } catch (error) {
    console.error('Error reading seen properties:', error);
    return { "Rightmove": [], "Zoopla": [] };
  }
}

function getIgnoredProperties() {
    try {
      const data = fs.readFileSync(IGNORED_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading ignored properties:', error);
      return {};
    }
}

function markAsSeen(propertyId, platform = 'Rightmove') {
  const seen = getSeenProperties();
  if (!seen[platform]) {
      seen[platform] = [];
  }
  if (!seen[platform].includes(propertyId)) {
    seen[platform].push(propertyId);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  }
}

function markAsIgnored(propertyId, platform = 'Rightmove', reason = 'unknown') {
    const ignored = getIgnoredProperties();
    if (!ignored[platform]) {
        ignored[platform] = {};
    }
    ignored[platform][propertyId] = {
        reason,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(IGNORED_FILE, JSON.stringify(ignored, null, 2));
}

function isSeen(propertyId, platform = 'Rightmove') {
  const seen = getSeenProperties();
  if (seen[platform] && seen[platform].includes(propertyId)) return true;
  
  const ignored = getIgnoredProperties();
  if (ignored[platform] && ignored[platform][propertyId]) return true;
  
  return false;
}

function saveMatch(propertyData) {
  const matchString = `### [${new Date().toISOString()}] MATCH FOUND!\n` +
    `- **Platform**: ${propertyData.platform}\n` +
    `- **Location**: ${propertyData.location || 'Unknown'}\n` +
    `- **ID**: ${propertyData.id}\n` +
    `- **Price**: £${propertyData.price} PCM\n` +
    `- **Size**: ${propertyData.sqm} sqm\n` +
    `- **Link**: [${propertyData.url}](${propertyData.url})\n\n---\n\n`;
  
  fs.appendFileSync(MATCHES_FILE, matchString);
  console.log(`Saved match: ${propertyData.url}`);
}

function updateLocationIfUnknown(propertyId, locationName) {
  if (!fs.existsSync(MATCHES_FILE)) return;
  let content = fs.readFileSync(MATCHES_FILE, 'utf-8');
  
  const regex = new RegExp(`- \\*\\*Location\\*\\*: Unknown\\n- \\*\\*ID\\*\\*: ${propertyId}`, 'g');
  if (regex.test(content)) {
    content = content.replace(regex, `- **Location**: ${locationName}\n- **ID**: ${propertyId}`);
    fs.writeFileSync(MATCHES_FILE, content);
    console.log(`Backfilled location for previously seen property: ${propertyId} -> ${locationName}`);
  }
}

module.exports = {
  getSeenProperties,
  getIgnoredProperties,
  markAsSeen,
  markAsIgnored,
  isSeen,
  saveMatch,
  updateLocationIfUnknown
};