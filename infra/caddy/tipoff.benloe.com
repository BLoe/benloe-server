tipoff.benloe.com {
    # Static: the board is three files and two frozen JSON snapshots. Draft
    # state lives in the browser, so nothing here is on the critical path once
    # the page has loaded.
    root * /srv/benloe/apps/tipoff/public
    file_server

    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        X-Robots-Tag "noindex, nofollow"
        # A re-run snapshot must reach the next reload.
        Cache-Control "no-cache"
    }

    log {
        output file /var/log/caddy/tipoff.benloe.com.log
    }
}
