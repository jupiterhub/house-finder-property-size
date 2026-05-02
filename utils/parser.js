/**
 * Parses text to extract square meterage (sqm) or square footage (sqft).
 * If sqft is found, it is converted to sqm.
 * If no total is found, it attempts to sum up individual room dimensions in meters.
 * @param {string} text - The text to parse.
 * @returns {number|null} The extracted size in sqm, or null if not found.
 */
function extractSqmFromText(text) {
  if (!text) return null;

  // Normalize text: lowercase, remove commas, handle newlines
  const normalizedText = text.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');

  // 1. Explicit totals
  const sqmRegex = /(\d+(?:\.\d+)?)\s*(?:sq\s*[mn]|sqm|sq\.m\.|square\s*meters?)/;
  const sqftRegex = /(\d+(?:\.\d+)?)\s*(?:sq\s*[fhtl]|sqft|sq\.ft\.|square\s*feet|square\s*foot)/;
  
  // Look for "Total approx. floor area 254 sq.ft. (23.6 sq.m.)"
  // Handling common OCR errors for "sq.m." like "sq.m", "sg.m", "sq.n"
  const combinedRegex = /(?:total|approx|floor|area).*?(\d+(?:\.\d+)?)\s*(?:sq\s*[fhtl]|sqft).*?\((\d+(?:\.\d+)?)\s*(?:sq\s*[mn]|sqm)\)/i;
  const combinedMatch = normalizedText.match(combinedRegex);
  if (combinedMatch) {
      return parseFloat(combinedMatch[2]);
  }

  const sqmMatch = normalizedText.match(sqmRegex);
  if (sqmMatch && sqmMatch[1]) {
    return parseFloat(sqmMatch[1]);
  }

  const sqftMatch = normalizedText.match(sqftRegex);
  if (sqftMatch && sqftMatch[1]) {
    const sqft = parseFloat(sqftMatch[1]);
    const sqm = sqft * 0.092903;
    return parseFloat(sqm.toFixed(2));
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