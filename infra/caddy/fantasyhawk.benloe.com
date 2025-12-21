fantasyhawk.benloe.com {
    # API proxy
    handle /api/* {
        reverse_proxy localhost:3005
    }

    # Serve static frontend
    handle {
        root * /srv/benloe/apps/fantasy-hawk/frontend/dist
        try_files {path} /index.html
        file_server
    }

    # Logging
    log {
        output file /var/log/caddy/fantasyhawk.benloe.com.log
    }
}
