FROM tiangolo/nginx-rtmp:latest

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create directories for HLS/DASH output
RUN mkdir -p /tmp/hls /tmp/dash && \
    chmod 777 /tmp/hls /tmp/dash

# Install FFmpeg for thumbnail generation and transcoding
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Expose ports
# 1935 - RTMP
# 8080 - HTTP (HLS/DASH)
EXPOSE 1935 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
