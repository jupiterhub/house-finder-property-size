const Tesseract = require('tesseract.js');

/**
 * Extracts text from an image URL using Tesseract.js.
 * @param {string|Buffer} imageSource - The URL or Buffer of the image.
 * @returns {Promise<string>} The extracted text.
 */
async function extractTextFromImage(imageSource) {
  try {
    const worker = await Tesseract.createWorker('eng');
    const { data: { text } } = await worker.recognize(imageSource);
    await worker.terminate();
    return text;
  } catch (error) {
    console.error('OCR Error:', error);
    return '';
  }
}

module.exports = {
  extractTextFromImage
};