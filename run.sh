#!/bin/bash

if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Property Scraper Wrapper"
  echo "Usage: bash run.sh [OPTIONS]"
  echo ""
  echo "Data Tidying Options (applied to data/matches.md and data/matches.html after scraping):"
  echo "  --sort <field>     Sort matches by field: ideal (default), recent, size, price"
  echo "  --order <asc|desc> Sort order: desc (default), asc"
  echo "  --max-price <num>  Filter out properties above this price"
  echo "  --verify           Perform live status verification of matches (removes let-agreed/off-market)"
  echo ""
  echo "Examples:"
  echo "  bash run.sh"
  echo "  bash run.sh --sort price --order asc"
  echo "  bash run.sh --max-price 2000"
  echo "  bash run.sh --verify"
  exit 0
fi

# Simple wrapper script to run the property scraper
echo "Starting the property scraper..."
node index.js "$@"

echo "Tidying data..."
# Automatically run live status verification under CI
VERIFY_FLAG=""
if [ "$CI" = "true" ]; then
  VERIFY_FLAG="--verify"
  echo "CI environment detected. Enabling live status verification..."
fi

# Pass all arguments to tidy_data.js as well so sorting options work
node tidy_data.js --clean-seen --migrate $VERIFY_FLAG "$@"
echo "Data tidy complete!"