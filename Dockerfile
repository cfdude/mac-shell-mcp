# Multi-stage build for Mac Shell MCP Server
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm ci --only=development

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies
# Note: This is a macOS shell command server, so running in Alpine Linux 
# will have limited functionality. This Docker image is primarily for 
# development and testing purposes.
RUN apk add --no-cache \
    bash \
    zsh \
    coreutils \
    findutils \
    grep \
    sed \
    awk

# Create non-root user
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/build ./build

# Copy necessary files
COPY README.md ./
COPY LICENSE ./

# Set ownership
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Set environment variables
ENV NODE_ENV=production
ENV MCP_SERVER_NAME=mac-shell-mcp

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Expose the default MCP stdio interface
# Note: MCP servers typically communicate via stdio, not network ports
EXPOSE 3000

# Start the MCP server
CMD ["node", "build/index.js"]

# Build instructions:
# docker build -t mac-shell-mcp .
#
# Run instructions:
# docker run -it --rm mac-shell-mcp
#
# For development with volume mounting:
# docker run -it --rm -v $(pwd):/app mac-shell-mcp
#
# Note: This Docker container has limitations since it's designed for macOS
# shell commands. Many macOS-specific commands will not work in a Linux container.