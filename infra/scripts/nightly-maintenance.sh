#!/bin/bash

# Nightly Maintenance Script for benloe.com VPS
# Runs at 4am ET daily via cron

# Load nvm and node
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Load Mailgun credentials from artanis environment
source /var/apps/artanis/.env 2>/dev/null || {
  echo "Warning: Could not load artanis .env file"
}

# Configuration
ADMIN_EMAIL="below413@gmail.com"
REPORT_DATE=$(date '+%Y-%m-%d %H:%M:%S %Z')
TEMP_REPORT="/tmp/maintenance-report-$(date +%s).txt"
ARTANIS_DB="/var/apps/artanis/prisma/artanis.db"

# Initialize report
cat > "$TEMP_REPORT" <<EOF
System Maintenance Report
Generated: $REPORT_DATE

EOF

# Function to add section to report
add_section() {
  echo "" >> "$TEMP_REPORT"
  echo "=== $1 ===" >> "$TEMP_REPORT"
  echo "" >> "$TEMP_REPORT"
}

# 1. System Status Check
add_section "System Status"
echo "Uptime:" >> "$TEMP_REPORT"
uptime >> "$TEMP_REPORT"
echo "" >> "$TEMP_REPORT"
echo "Disk Usage:" >> "$TEMP_REPORT"
df -h / | tail -n 1 | awk '{print "Root: " $3 " used of " $2 " (" $5 " full)"}' >> "$TEMP_REPORT"
echo "" >> "$TEMP_REPORT"
echo "Memory Usage:" >> "$TEMP_REPORT"
free -h | grep Mem | awk '{print "RAM: " $3 " used of " $2}' >> "$TEMP_REPORT"

# 2. Check for system updates
add_section "System Updates"
apt update -qq 2>&1
UPDATE_COUNT=$(apt list --upgradable 2>/dev/null | grep -c upgradable)
if [ "$UPDATE_COUNT" -gt 1 ]; then
  echo "$((UPDATE_COUNT - 1)) package(s) available for update" >> "$TEMP_REPORT"
  echo "" >> "$TEMP_REPORT"
  apt list --upgradable 2>/dev/null | grep -v "Listing" | head -10 >> "$TEMP_REPORT"
  if [ "$UPDATE_COUNT" -gt 11 ]; then
    echo "... and $((UPDATE_COUNT - 11)) more" >> "$TEMP_REPORT"
  fi
  echo "" >> "$TEMP_REPORT"
  echo "⚠️  Manual review required for system updates" >> "$TEMP_REPORT"
else
  echo "✓ System is up to date" >> "$TEMP_REPORT"
fi

# 3. Check running services
add_section "Running Services"
pm2 list 2>&1 | grep -E "(online|stopped|errored)" >> "$TEMP_REPORT" || echo "No PM2 services detected" >> "$TEMP_REPORT"

# 4. Check new user signups in last 24 hours
add_section "New User Signups (Last 24 Hours)"
if [ -f "$ARTANIS_DB" ]; then
  NEW_USERS=$(sqlite3 "$ARTANIS_DB" "SELECT email, datetime(createdAt, 'localtime') as signup_time FROM users WHERE createdAt >= datetime('now', '-1 day') ORDER BY createdAt DESC;" 2>/dev/null)

  if [ -n "$NEW_USERS" ]; then
    echo "$NEW_USERS" | while IFS='|' read -r email signup_time; do
      echo "• $email (signed up: $signup_time)" >> "$TEMP_REPORT"
    done
  else
    echo "No new user signups in the last 24 hours" >> "$TEMP_REPORT"
  fi
else
  echo "⚠️  Could not access artanis database" >> "$TEMP_REPORT"
fi

# 5. Check for suspicious activity (failed service attempts)
add_section "Service Health"
FAILED_SERVICES=$(systemctl --failed --no-pager --no-legend 2>/dev/null | wc -l)
if [ "$FAILED_SERVICES" -gt 0 ]; then
  echo "⚠️  $FAILED_SERVICES failed systemd service(s):" >> "$TEMP_REPORT"
  systemctl --failed --no-pager --no-legend >> "$TEMP_REPORT"
else
  echo "✓ All systemd services running normally" >> "$TEMP_REPORT"
fi

# 6. Add something joyful/creative
add_section "✨ Daily Joy"

# Array of creative additions
JOYS=(
  "🎲 Random Project Idea: Build a 'What Should I Cook Tonight?' app that suggests recipes based on your pantry inventory and mood"
  "📅 On this day in tech history ($(date +%B\ %d)): The internet remembers its pioneers and celebrates another day of building cool things"
  "💭 Developer Wisdom: 'The best code is no code at all. The second best is code that deletes itself after running. The third best is code that makes you smile.'"
  "🎨 Weekend Project Spark: Create a minimalist dashboard that shows only the most important metric in your life - maybe days since last system crash? (Currently: $(awk '{print int($1/86400)}' /proc/uptime) days!)"
  "🌟 Thought for today: Your server has been faithfully running for $(awk '{print int($1/86400)}' /proc/uptime) days. Maybe it deserves a thank you note in the logs?"
  "🚀 Build Suggestion: A 'Digital Garden' where each subdomain is a different plant that grows based on usage/traffic metrics"
  "🎯 Mini Challenge: Can you build something useful in a single HTML file today? Sometimes constraints breed creativity."
  "📖 Story Time: Once upon a time, a developer deployed on a Friday. They learned. They grew. They never did it again. The end."
  "🎵 Code Haiku:\nServers hum at night\nBackups flowing like a stream\nAll tests passing green"
  "💡 Shower Thought: If your code runs in production and nobody's monitoring it, does it make a sound when it crashes?"
)

# Select random joy based on day of year
DAY_OF_YEAR=$(date +%j)
JOY_INDEX=$((DAY_OF_YEAR % ${#JOYS[@]}))
echo "${JOYS[$JOY_INDEX]}" >> "$TEMP_REPORT"

# 7. Restart all PM2 applications
add_section "Application Restart"
echo "Restarting all PM2 applications..." >> "$TEMP_REPORT"
pm2 restart all 2>&1 >> "$TEMP_REPORT"
echo "" >> "$TEMP_REPORT"
echo "Current PM2 status after restart:" >> "$TEMP_REPORT"
pm2 list 2>&1 | grep -E "(online|stopped|errored)" >> "$TEMP_REPORT"

# 8. Footer
echo "" >> "$TEMP_REPORT"
echo "---" >> "$TEMP_REPORT"
echo "Generated by nightly-maintenance.sh" >> "$TEMP_REPORT"
echo "Next run: $(date -d 'tomorrow 04:00' '+%Y-%m-%d %H:%M %Z')" >> "$TEMP_REPORT"

# Send email using Mailgun API with Node.js
MAILGUN_API_KEY="$MAILGUN_API_KEY" MAILGUN_DOMAIN="$MAILGUN_DOMAIN" FROM_EMAIL="$FROM_EMAIL" REPORT_FILE="$TEMP_REPORT" node - <<'NODESCRIPT'
const https = require('https');
const fs = require('fs');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mail.benloe.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@mail.benloe.com';

// Read the report
const report = fs.readFileSync(process.env.REPORT_FILE, 'utf8');

// Prepare email data
const formData = new URLSearchParams();
formData.append('from', `System Maintenance <${FROM_EMAIL}>`);
formData.append('to', 'below413@gmail.com');
formData.append('subject', `🔧 Nightly Maintenance Report - ${new Date().toLocaleDateString()}`);
formData.append('text', report);

// Send via Mailgun API
const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');

const options = {
  hostname: 'api.mailgun.net',
  path: `/v3/${MAILGUN_DOMAIN}/messages`,
  method: 'POST',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': formData.toString().length
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✓ Maintenance report sent successfully');
    } else {
      console.error('✗ Failed to send report:', res.statusCode, data);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('✗ Error sending email:', error.message);
  process.exit(1);
});

req.write(formData.toString());
req.end();
NODESCRIPT

# Cleanup
rm -f "$TEMP_REPORT"