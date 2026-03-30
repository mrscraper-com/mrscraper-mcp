# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    HOST=0.0.0.0

# Install system dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml README.md ./
COPY server.py ./
COPY mrscraper_mcp ./mrscraper_mcp/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Expose the port
EXPOSE ${PORT}

# Run the server with HTTP transport
# The server will use HTTP transport when TRANSPORT env var is set to "http"
ENV TRANSPORT=http
CMD ["python", "server.py"]
