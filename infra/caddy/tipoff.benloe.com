tipoff.benloe.com {
    # The screenshot drop box and the owner gate. Both live in tipoff-api
    # (port 3014), which checks the artanis cookie itself.
    handle /api/* {
        reverse_proxy 127.0.0.1:3014
    }

    # The board: static files, owner only. forward_auth asks tipoff-api
    # whether this browser is Ben (204); a signed-out browser is sent to
    # artanis and comes back here; anyone else signed in gets the 403.
    # Once the page has loaded, the draft itself touches neither service.
    handle {
        forward_auth 127.0.0.1:3014 {
            uri /api/gate
            @signin status 401
            handle_response @signin {
                redir https://auth.benloe.com/?redirect=https://tipoff.benloe.com{uri} 302
            }
        }
        root * /srv/benloe/apps/tipoff/public
        file_server
    }

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
