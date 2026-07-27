kickball.benloe.com {
    # API and health check
    handle /api/* {
        reverse_proxy 127.0.0.1:3009
    }
    handle /health {
        reverse_proxy 127.0.0.1:3009
    }

    # React SPA
    handle {
        root * /srv/benloe/apps/kickball/web/dist
        try_files {path} /index.html
        file_server
    }

    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    @html {
        file
        path *.html /
    }
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    @static {
        file
        path /assets/* *.png *.svg *.ico *.woff *.woff2
    }
    header @static Cache-Control "public, max-age=31536000"

    log {
        output file /var/log/caddy/kickball.benloe.com.log
    }
}
