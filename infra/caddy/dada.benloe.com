dada.benloe.com {
    # Handle API requests
    handle /api/* {
        reverse_proxy localhost:3004
    }

    # Handle static files
    handle {
        root * /srv/benloe/static/dada.benloe.com
        try_files {path} {path}/ /index.html
        file_server
    }

    # Enable compression
    encode gzip

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        X-XSS-Protection "1; mode=block"
        Referrer-Policy strict-origin-when-cross-origin
        # Content Security Policy for static app
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self' https://auth.benloe.com https://dada.benloe.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';"
    }

    # No cache for HTML files
    @html {
        file
        path *.html /
    }
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    # Cache static assets
    @static {
        file
        path *.css *.js *.png *.jpg *.jpeg *.gif *.webp *.svg *.ico
    }
    header @static Cache-Control "public, max-age=31536000"

    # Logs
    log {
        output file /var/log/caddy/dada.log
        format json
    }
}
