#!/bin/bash

if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Property Scraper Wrapper"
  echo "Usage: bash run.sh [OPTIONS]"
  echo ""
  echo "Scraping Options:"
  echo "  --with-zoopla      Enable Zoopla scraping (disabled by default due to Cloudflare anti-bot checks)"
  echo ""
  echo "Data Tidying Options (applied to data/matches.md after scraping):"
  echo "  --sort <field>     Sort matches by field: recent (default), size, price"
  echo "  --order <asc|desc> Sort order: desc (default), asc"
  echo "  --max-price <num>  Filter out properties above this price"
  echo ""
  echo "Examples:"
  echo "  bash run.sh --with-zoopla"
  echo "  bash run.sh --sort price --order asc"
  echo "  bash run.sh --with-zoopla --max-price 2000"
  exit 0
fi

# Simple wrapper script to run the property scraper
echo "Starting the property scraper..."
node index.js "$@"

echo "Tidying data..."
# Pass all arguments to tidy_data.js as well so sorting options work
node tidy_data.js --clean-seen --migrate "$@"
echo "Data tidy complete!"