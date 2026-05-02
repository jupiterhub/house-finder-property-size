const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEEN_FILE = path.join(DATA_DIR, 'seen_properties.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.txt');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure files exist
if (!fs.existsSync(SEEN_FILE)) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([]));
}

function getSeenProperties() {
  try {
    const data = fs.readFileSync(SEEN_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading seen properties:', error);
    return [];
  }
}

function markAsSeen(propertyId) {
  const seen = getSeenProperties();
  if (!seen.includes(propertyId)) {
    seen.push(propertyId);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  }
}

function isSeen(propertyId) {
  const seen = getSeenProperties();
  return seen.includes(propertyId);
}

function saveMatch(propertyData) {
  const matchString = `[${new Date().toISOString()}] MATCH FOUND!\n` +
    `Platform: ${propertyData.platform}\n` +
    `ID: ${propertyData.id}\n` +
    `Price: £${propertyData.price} PCM\n` +
    `Size: ${propertyData.sqm} sqm\n` +
    `Link: ${propertyData.url}\n` +
    `----------------------------------------\n`;
  
  fs.appendFileSync(MATCHES_FILE, matchString);
  console.log(`Saved match: ${propertyData.url}`);
}

module.exports = {
  getSeenProperties,
  markAsSeen,
  isSeen,
  saveMatch
};