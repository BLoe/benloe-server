relay.benloe.com {
    # Message channel between Benji (Ben's work agent) and Claude Code on this
    # box. relay-api (port 3015) authenticates every /v1 request by bearer
    # token itself; there is no browser UI and no artanis cookie involved.
    request_body {
        max_size 1MB
    }
    reverse_proxy 127.0.0.1:3015

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        X-Robots-Tag "noindex, nofollow"
        Cache-Control "no-store"
    }

    # Tokens travel in the Authorization header, which Caddy redacts from
    # access logs by default. Never accept one in a query string.
    log {
        output file /var/log/caddy/relay.benloe.com.log
    }
}
