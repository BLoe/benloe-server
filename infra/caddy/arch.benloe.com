arch.benloe.com {
    root * /srv/benloe/static/arch.benloe.com
    try_files {path} {path}/ /index.html
    file_server

    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        # Single self-contained page: no scripts, no external anything.
        Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"
    }

    @html {
        file
        path *.html /
    }
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    log {
        output file /var/log/caddy/arch.benloe.com.log
        format json
    }
}
