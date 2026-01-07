yahoomcp.benloe.com {
    reverse_proxy localhost:3006

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    log {
        output file /var/log/caddy/yahoomcp.benloe.com.log
    }
}
