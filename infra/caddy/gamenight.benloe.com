gamenight.benloe.com {
    # Security headers
    header {
        # Enable HSTS
        Strict-Transport-Security max-age=31536000; includeSubdomains; preload
        # Prevent MIME type sniffing
        X-Content-Type-Options nosniff
        # Prevent clickjacking
        X-Frame-Options DENY
        # XSS protection
        X-XSS-Protection "1; mode=block"
        # Referrer policy
        Referrer-Policy strict-origin-when-cross-origin
        # Content Security Policy for React app
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self' https:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';"
    }

    # API endpoints proxied to gamenight API
    handle /api/* {
        reverse_proxy localhost:3001
    }
    
    # Frontend served from static files (built React app)
    handle {
        root * /var/apps/gamenight/dist
        file_server
        encode gzip
        
        # SPA routing - serve index.html for all non-API routes
        try_files {path} /index.html
    }
    
    # Logs for security monitoring
    log {
        output file /var/log/caddy/gamenight.log
        format json
    }
}