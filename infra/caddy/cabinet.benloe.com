cabinet.benloe.com {
    handle {
        root * /srv/benloe/static/cabinet.benloe.com
        try_files {path} {path}/ /index.html
        file_server
    }

    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
    }
    @html path *.html /
    header @html Cache-Control "no-cache"

    log {
        output file /var/log/caddy/cabinet.benloe.com.log
    }
}
