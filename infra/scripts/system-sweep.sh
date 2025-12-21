#!/bin/bash

# System Security and Maintenance Sweep Script for benloe.com
# Comprehensive check of all server systems, applications, and infrastructure

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DRY_RUN=false
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SWEEP_LOG="/tmp/sweep_${TIMESTAMP}.log"
CHANGES_MADE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$SWEEP_LOG"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✓${NC} $1" | tee -a "$SWEEP_LOG"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠${NC} $1" | tee -a "$SWEEP_LOG"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ✗${NC} $1" | tee -a "$SWEEP_LOG"
}

header() {
    echo | tee -a "$SWEEP_LOG"
    echo -e "${BLUE}==================== $1 ====================${NC}" | tee -a "$SWEEP_LOG"
}

# Function to safely execute commands in dry-run mode
safe_execute() {
    local cmd="$1"
    local description="$2"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would execute: $cmd"
        log "  Purpose: $description"
    else
        log "Executing: $description"
        eval "$cmd" 2>&1 | tee -a "$SWEEP_LOG" || {
            log_error "Failed: $description"
            return 1
        }
        CHANGES_MADE=true
    fi
}

# System Information and Health Check
system_health_check() {
    header "SYSTEM HEALTH CHECK"
    
    log "System uptime:"
    uptime | tee -a "$SWEEP_LOG"
    
    log "Memory usage:"
    free -h | tee -a "$SWEEP_LOG"
    
    log "Disk usage:"
    df -h | tee -a "$SWEEP_LOG"
    
    log "CPU load:"
    cat /proc/loadavg | tee -a "$SWEEP_LOG"
    
    log "Active services:"
    systemctl --type=service --state=active | tee -a "$SWEEP_LOG"
    
    # Check for failed services
    local failed_services=$(systemctl --type=service --state=failed --no-legend | wc -l)
    if [[ $failed_services -gt 0 ]]; then
        log_warning "Found $failed_services failed services:"
        systemctl --type=service --state=failed | tee -a "$SWEEP_LOG"
    else
        log_success "No failed services found"
    fi
}

# Security Checks
security_checks() {
    header "SECURITY CHECKS"
    
    log "Checking SSH configuration:"
    if grep -q "PermitRootLogin no\|PasswordAuthentication no" /etc/ssh/sshd_config; then
        log_success "SSH security settings appear correct"
    else
        log_warning "SSH configuration may need security review"
    fi
    
    log "Checking firewall status:"
    ufw status | tee -a "$SWEEP_LOG"
    
    log "Recent auth failures (last 50):"
    journalctl -u ssh -n 50 --no-pager | grep -i "failed\|invalid" | tail -10 | tee -a "$SWEEP_LOG" || log "No recent auth failures found"
    
    log "Checking for suspicious processes:"
    ps aux --sort=-%cpu | head -20 | tee -a "$SWEEP_LOG"
    
    log "Checking open ports:"
    ss -tuln | tee -a "$SWEEP_LOG"
}

# Log Analysis
log_analysis() {
    header "LOG ANALYSIS"
    
    log "System journal errors (last 24 hours):"
    journalctl --since "24 hours ago" --priority=err --no-pager | tail -20 | tee -a "$SWEEP_LOG" || log "No system errors in last 24 hours"
    
    log "Caddy access log analysis (last 100 entries):"
    if [[ -f /var/log/caddy/access.log ]]; then
        tail -100 /var/log/caddy/access.log | awk '{print $9}' | sort | uniq -c | sort -nr | head -10 | tee -a "$SWEEP_LOG"
    else
        log "Caddy access log not found"
    fi
    
    log "Caddy error log (last 50 lines):"
    if [[ -f /var/log/caddy/error.log ]]; then
        tail -50 /var/log/caddy/error.log | tee -a "$SWEEP_LOG" || log "No recent Caddy errors"
    else
        log "Caddy error log not found"
    fi
    
    log "PM2 application logs:"
    if command -v pm2 &> /dev/null; then
        pm2 list | tee -a "$SWEEP_LOG"
        pm2 logs --lines 10 --nostream | tee -a "$SWEEP_LOG" 2>/dev/null || log "No PM2 logs available"
    else
        log "PM2 not installed"
    fi
}

# Application Health Checks
app_health_checks() {
    header "APPLICATION HEALTH CHECKS"
    
    # Check web applications
    local apps=()
    
    # Find all web directories
    if [[ -d /var/www ]]; then
        for app_dir in /var/www/*/; do
            if [[ -d "$app_dir" ]]; then
                apps+=("$(basename "$app_dir")")
            fi
        done
    fi
    
    # Find all node applications
    if [[ -d /var/apps ]]; then
        for app_dir in /var/apps/*/; do
            if [[ -d "$app_dir" ]]; then
                apps+=("$(basename "$app_dir")")
            fi
        done
    fi
    
    log "Found applications: ${apps[*]}"
    
    # Check each application
    for app in "${apps[@]}"; do
        log "Checking application: $app"
        
        # Check if it's a web app
        if [[ -d "/var/www/$app" ]]; then
            cd "/var/www/$app"
            log "  Type: Web application (PHP/Static)"
            
            # Check for PHP files and common issues
            if find . -name "*.php" -type f | head -1 | grep -q "."; then
                log "  Contains PHP files"
                php -l $(find . -name "*.php" -type f | head -5) 2>&1 | tee -a "$SWEEP_LOG" || log_warning "  PHP syntax check failed"
            fi
            
            # Check git status
            if [[ -d .git ]]; then
                log "  Git status:"
                git status --porcelain | tee -a "$SWEEP_LOG" || log "  No git changes"
            fi
        fi
        
        # Check if it's a node app
        if [[ -d "/var/apps/$app" ]]; then
            cd "/var/apps/$app"
            log "  Type: Node.js application"
            
            if [[ -f package.json ]]; then
                log "  Package.json found"
                
                # Check for outdated dependencies
                if command -v npm &> /dev/null; then
                    log "  Checking for outdated dependencies:"
                    npm outdated 2>&1 | tee -a "$SWEEP_LOG" || log "  All dependencies up to date"
                fi
                
                # Check git status
                if [[ -d .git ]]; then
                    log "  Git status:"
                    git status --porcelain | tee -a "$SWEEP_LOG" || log "  No git changes"
                fi
            fi
        fi
    done
}

# Dependency Updates
dependency_updates() {
    header "DEPENDENCY UPDATES"
    
    # System packages
    log "Checking system package updates:"
    apt list --upgradable 2>/dev/null | tee -a "$SWEEP_LOG" || log "No system updates available"
    
    if [[ "$DRY_RUN" == "false" ]]; then
        log "Updating package lists:"
        apt update 2>&1 | tee -a "$SWEEP_LOG"
        
        local upgradable=$(apt list --upgradable 2>/dev/null | wc -l)
        if [[ $upgradable -gt 1 ]]; then
            log_warning "$upgradable packages can be upgraded"
            log "Consider running: apt upgrade"
        else
            log_success "System packages are up to date"
        fi
    fi
    
    # Node.js applications
    for app_dir in /var/apps/*/; do
        if [[ -d "$app_dir" && -f "$app_dir/package.json" ]]; then
            app_name=$(basename "$app_dir")
            log "Checking Node.js dependencies for $app_name:"
            cd "$app_dir"
            
            if command -v npm &> /dev/null; then
                # Update dependencies if not in dry run
                if [[ "$DRY_RUN" == "false" ]]; then
                    safe_execute "npm audit fix" "Fix npm security vulnerabilities for $app_name"
                    safe_execute "npm update" "Update dependencies for $app_name"
                else
                    log "[DRY RUN] Would run npm audit fix and npm update for $app_name"
                fi
            fi
        fi
    done
}

# Configuration Validation
config_validation() {
    header "CONFIGURATION VALIDATION"
    
    log "Validating Caddy configuration:"
    if command -v caddy &> /dev/null; then
        caddy validate --config /etc/caddy/Caddyfile 2>&1 | tee -a "$SWEEP_LOG" && log_success "Caddy configuration is valid" || log_error "Caddy configuration has issues"
    else
        log_warning "Caddy not found"
    fi
    
    log "Checking Caddy site configurations:"
    if [[ -d /etc/caddy/Caddyfile.d ]]; then
        for config in /etc/caddy/Caddyfile.d/*; do
            if [[ -f "$config" ]]; then
                log "  Configuration: $(basename "$config")"
                cat "$config" | tee -a "$SWEEP_LOG"
            fi
        done
    fi
}

# Git Repository Management
git_management() {
    header "GIT REPOSITORY MANAGEMENT"
    
    local repos=()
    
    # Find all git repositories
    find /var/www /var/apps -name ".git" -type d 2>/dev/null | while read git_dir; do
        repo_dir=$(dirname "$git_dir")
        repos+=("$repo_dir")
    done
    
    # Check main monorepo if it exists
    local main_repo="/var/repos/benloe-monorepo"
    if [[ -d "$main_repo/.git" ]]; then
        repos+=("$main_repo")
    fi
    
    for repo in "${repos[@]}"; do
        if [[ -d "$repo" ]]; then
            log "Processing repository: $repo"
            cd "$repo"
            
            # Check git status
            local status=$(git status --porcelain)
            if [[ -n "$status" ]]; then
                log "  Uncommitted changes found:"
                git status | tee -a "$SWEEP_LOG"
                
                if [[ "$DRY_RUN" == "false" ]]; then
                    log "  Adding all changes to git:"
                    git add . 2>&1 | tee -a "$SWEEP_LOG"
                    
                    log "  Committing changes:"
                    local commit_msg="System sweep maintenance - $(date '+%Y-%m-%d %H:%M:%S')

Automated maintenance sweep including:
- Security checks and log analysis
- Dependency updates where applicable
- Configuration validation
- Application health checks

Generated by /sweep command"
                    
                    git commit -m "$commit_msg" 2>&1 | tee -a "$SWEEP_LOG" && log_success "  Changes committed" || log_error "  Failed to commit changes"
                    CHANGES_MADE=true
                else
                    log "[DRY RUN] Would commit changes in $repo"
                fi
            else
                log_success "  Repository is clean"
            fi
            
            # Check for unpushed commits
            local unpushed=$(git log --oneline @{u}.. 2>/dev/null | wc -l)
            if [[ $unpushed -gt 0 ]]; then
                log_warning "  $unpushed unpushed commits found"
                if [[ "$DRY_RUN" == "false" ]]; then
                    log "  Consider pushing changes: git push"
                fi
            fi
        fi
    done
}

# Cleanup and Optimization
cleanup_optimization() {
    header "CLEANUP AND OPTIMIZATION"

    log "Checking disk space usage:"
    df -h | tee -a "$SWEEP_LOG"

    log "Cleaning package cache:"
    if [[ "$DRY_RUN" == "false" ]]; then
        apt autoremove -y 2>&1 | tee -a "$SWEEP_LOG"
        apt autoclean 2>&1 | tee -a "$SWEEP_LOG"
    else
        log "[DRY RUN] Would run apt autoremove and autoclean"
    fi

    log "Checking for large log files:"
    find /var/log -name "*.log" -size +100M 2>/dev/null | tee -a "$SWEEP_LOG" || log "No large log files found"

    log "Checking journal size:"
    journalctl --disk-usage | tee -a "$SWEEP_LOG"
}

# Restart Applications
restart_applications() {
    header "APPLICATION RESTART"

    if command -v pm2 &> /dev/null; then
        log "Restarting all PM2 applications:"
        if [[ "$DRY_RUN" == "false" ]]; then
            pm2 restart all 2>&1 | tee -a "$SWEEP_LOG" && log_success "All PM2 applications restarted" || log_error "Failed to restart some applications"

            log "Current PM2 status after restart:"
            pm2 list | tee -a "$SWEEP_LOG"
        else
            log "[DRY RUN] Would restart all PM2 applications"
        fi
    else
        log "PM2 not found, skipping application restart"
    fi
}

# Generate Summary Report
generate_summary() {
    header "SWEEP SUMMARY REPORT"
    
    log "Sweep completed at: $(date)"
    log "Mode: $(if [[ "$DRY_RUN" == "true" ]]; then echo "DRY RUN"; else echo "LIVE EXECUTION"; fi)"
    log "Changes made: $(if [[ "$CHANGES_MADE" == "true" ]]; then echo "YES"; else echo "NO"; fi)"
    log "Full log available at: $SWEEP_LOG"
    
    # Count different types of findings
    local warnings=$(grep -c "⚠" "$SWEEP_LOG" || echo "0")
    local errors=$(grep -c "✗" "$SWEEP_LOG" || echo "0")
    local successes=$(grep -c "✓" "$SWEEP_LOG" || echo "0")
    
    log "Summary: $successes successes, $warnings warnings, $errors errors"
    
    if [[ $warnings -gt 0 || $errors -gt 0 ]]; then
        log_warning "Review the log file for warnings and errors that need attention"
    else
        log_success "System sweep completed with no issues found!"
    fi
}

# Main execution
main() {
    log "Starting comprehensive system sweep for benloe.com server"
    log "Timestamp: $(date)"
    log "Mode: $(if [[ "$DRY_RUN" == "true" ]]; then echo "DRY RUN - No changes will be made"; else echo "LIVE EXECUTION - Changes will be made"; fi)"
    
    system_health_check
    security_checks
    log_analysis
    app_health_checks
    dependency_updates
    config_validation
    git_management
    cleanup_optimization
    restart_applications
    generate_summary
    
    log "System sweep completed. Check $SWEEP_LOG for full details."
}

# Execute main function
main "$@"