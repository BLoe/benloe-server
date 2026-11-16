kevin.benloe.com {
    # Kevin, Ben's personal agent. kevin-api (port 3016) serves the web app,
    # the API and the event stream, and checks the artanis session itself on
    # every request: owner only.
    request_body {
        max_size 30MB
    }
    reverse_proxy 127.0.0.1:3016 {
        # The event stream must reach the browser as it is written.
        flush_interval -1
    }
    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Robots-Tag "noindex, nofollow"
    }

    log {
        output file /var/log/caddy/kevin.benloe.com.log
    }
}
