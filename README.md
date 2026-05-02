# London House Finder Scraper

An automated property scraper for **Rightmove** and **Zoopla** that specifically filters for apartments by square meterage (sqm).

## 🚀 Quick Start
You don't need to navigate to the project folder. Use the shortcuts in your home directory:

- **Run Scraper:** `./start-finder.sh`
- **View Matches:** `./view-results.sh`

## ✨ Key Features
- **Agnostic Scraping:** Handles both Rightmove and Zoopla search results.
- **Smart SQM Extraction:** 
    - Scans property descriptions for size mentions.
    - Automatically clicks "Floor Plan" tabs.
    - Uses **OCR (Optical Character Recognition)** to read text inside floorplan images.
    - **Geometric Fallback:** If a total area isn't found, it sums up individual room dimensions (e.g., `3.47m x 3.28m`) to estimate total size.
- **CAPTCHA Resilience:** Detects Cloudflare "Verify you are human" checks and pauses the script until you manually resolve them in the browser window.
- **Persistent Memory:** Tracks every property ID in `data/seen_properties.json` so you never re-process or re-OCR the same listing twice.

## ⚙️ Configuration
You can edit `config.json` in the project directory to update your search:
- `maxPrice`: Your maximum monthly budget (currently £2500).
- `minSqm`: Your minimum required size (currently 40 sqm).
- `rightmoveUrls` / `zooplaUrls`: Add or remove search links here.

## 📂 Output Files
- **`data/matches.md`**: A clean, readable Markdown log of all properties that meet your criteria.
- **`data/seen_properties.json`**: The database of processed property IDs.

## 🧹 Data Management
Use the `tidy_data.js` script to manage your matches and clean up seen properties:
- **Tidy & Migrate**: `node tidy_data.js --migrate` (converts .txt to .md and deduplicates).
- **Clean Seen Properties**: `node tidy_data.js --clean-seen` (deduplicates and sorts IDs).
- **Filter by Price**: `node tidy_data.js --max-price 2500 --output data/budget_matches.md`.
- **Sort Matches**: `node tidy_data.js --sort price --order asc`.

## 🛠 Troubleshooting
- **CAPTCHA:** If the terminal says "CAPTCHA detected", look at the browser window that popped up, click the "Verify you are human" checkbox, and wait. The terminal will resume automatically.
- **No matches?** If you are seeing too few matches, you can lower the `minSqm` or increase `maxPrice` in `config.json`.
