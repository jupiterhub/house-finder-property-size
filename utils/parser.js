/**
 * Parses text to extract square meterage (sqm) or square footage (sqft).
 * If sqft is found, it is converted to sqm.
 * If no total is found, it attempts to sum up individual room dimensions in meters.
 * @param {string} text - The text to parse.
 * @returns {number|null} The extracted size in sqm, or null if not found.
 */
function extractSqmFromText(text) {
  if (!text) return null;

  // Normalize text: lowercase, remove commas, normalize superscript ², handle newlines
  const normalizedText = text.toLowerCase().replace(/,/g, '').replace(/²/g, '2').replace(/\s+/g, ' ');

  // 1. Look for combined patterns like "Approx. 557 sq ft (52 sq m)" or "557 sq. ft. (51.7 sq. m.)"
  const combinedRegex = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*f|sqft|ft2).*?\(?\s*(?:approx\.?\s*)?(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m2)/i;
  const combinedMatch = normalizedText.match(combinedRegex);
  if (combinedMatch) {
    const val = parseFloat(combinedMatch[2]);
    if (val >= 15 && val <= 1000) return val;
  }

  // 2. Look for explicit sqm / m2 / square meters
  const sqmRegex = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m\.?|sqm|m2|square\s*met(?:er|re)s?)/i;
  const sqmMatch = normalizedText.match(sqmRegex);
  if (sqmMatch && sqmMatch[1]) {
    const val = parseFloat(sqmMatch[1]);
    if (val >= 15 && val <= 1000) return val;
  }

  // 3. Look for explicit sqft / ft2 / square feet
  const sqftRegex = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*f\.?t?|sqft|ft2|square\s*feet|square\s*foot)/i;
  const sqftMatch = normalizedText.match(sqftRegex);
  if (sqftMatch && sqftMatch[1]) {
    const sqft = parseFloat(sqftMatch[1]);
    if (sqft >= 150 && sqft <= 10000) {
      const sqm = sqft * 0.092903;
      return parseFloat(sqm.toFixed(2));
    }
  }

  // 2. Fallback: Sum up room dimensions (e.g., "3.66x2.80m" or "366x280m" due to OCR missing dots)
  const dimensionRegex = /(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*m/g;
  let totalArea = 0;
  let match;
  while ((match = dimensionRegex.exec(normalizedText)) !== null) {
      let width = parseFloat(match[1]);
      let length = parseFloat(match[2]);
      
      // Fix missing decimals from OCR (e.g. 366 instead of 3.66)
      if (width > 100) width = width / 100;
      if (width > 20 && width <= 100) width = width / 10;
      
      if (length > 100) length = length / 100;
      if (length > 20 && length <= 100) length = length / 10;

      if (width > 0 && length > 0 && width < 20 && length < 20) { // basic sanity check
          totalArea += (width * length);
      }
  }

  // Add 10% to account for hallways/bathrooms typically not explicitly dimensioned if we found rooms
  if (totalArea > 0) {
      const estimatedTotal = totalArea * 1.10; 
      return parseFloat(estimatedTotal.toFixed(2));
  }

  return null;
}

module.exports = {
  extractSqmFromText
};