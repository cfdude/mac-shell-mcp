#!/bin/bash

# Build the project if needed
if [ ! -d "./build" ] || [ ! -f "./build/index.js" ]; then
  echo "Building project..."
  npm run build
fi

# Run the MCP server
echo "Starting Mac Shell MCP Server..."
node build/index.js