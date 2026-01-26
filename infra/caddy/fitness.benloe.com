fitness.benloe.com {
    # Handle API requests
    handle /api/* {
        reverse_proxy localhost:3007
    }

    # Handle health check
    handle /health {
        reverse_proxy localhost:3007
    }

    # Handle static files (React SPA)
    handle {
        root * /srv/benloe/apps/fitness/dist
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

    log {
        output file /var/log/caddy/fitness.benloe.com.log
    }
}
