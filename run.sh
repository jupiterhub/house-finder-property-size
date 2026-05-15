#!/bin/bash

# Simple wrapper script to run the property scraper
echo "Starting the property scraper..."
node index.js

echo "Tidying data..."
node tidy_data.js --clean-seen --migrate
echo "Data tidy complete!"
