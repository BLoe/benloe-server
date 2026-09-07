gavel.benloe.com {
    # The Node app serves the API and the SPA shell alike. Unlike its siblings,
    # Caddy does NOT serve dist/ off disk here: the app must be able to answer
    # entirely from one process during a draft, so there is one thing to check
    # when something is wrong at 8:45pm rather than two.
    reverse_proxy 127.0.0.1:3013

    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        # A private draft board has no business in a search index.
        X-Robots-Tag "noindex, nofollow"
    }

    log {
        output file /var/log/caddy/gavel.benloe.com.log
    }
}
