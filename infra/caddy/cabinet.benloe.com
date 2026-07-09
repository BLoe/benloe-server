cabinet.benloe.com {
    # API + liveness → the gateway (owner-walled behind Artanis)
    handle /api/* {
        reverse_proxy 127.0.0.1:3008 {
            flush_interval -1
        }
    }
    handle /healthz {
        reverse_proxy 127.0.0.1:3008
    }

    # the Cabinet v2 SPA
    handle {
        root * /srv/benloe/apps/cabinet/web/dist
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
    header /sw.js Cache-Control "no-cache"
    @static {
        file
        path /assets/* *.png *.svg
    }
    header @static Cache-Control "public, max-age=31536000"

    log {
        output file /var/log/caddy/cabinet.benloe.com.log
    }
}
