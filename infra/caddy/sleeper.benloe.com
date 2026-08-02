sleeper.benloe.com {
    # API is served by the Node app on 3010.
    handle /api/* {
        reverse_proxy 127.0.0.1:3010
    }

    # React SPA, served straight off disk by Caddy.
    handle {
        root * /srv/benloe/apps/sleeper-ui/dist
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
        path /assets/* /fonts/* *.png *.svg *.ico *.woff *.woff2 *.webmanifest
    }
    header @static Cache-Control "public, max-age=31536000"

    log {
        output file /var/log/caddy/sleeper.benloe.com.log
    }
}
