# Dependency Management Strategy

**Last Updated:** October 14, 2025
**Purpose:** Prevent breaking changes from automatic dependency updates

## Problem

Unpinned CDN dependencies and loose npm version ranges can cause breaking changes to silently deploy to production, breaking applications without any code changes.

**Example:** The weights app broke on October 14, 2025 when Chart.js automatically updated from v3.x to v4.x via an unpinned CDN link, introducing breaking date format changes.

---

## Strategy Overview

### 1. Static Sites (CDN Dependencies)

**ALWAYS pin exact versions** for all CDN-loaded libraries.

#### ✅ Correct Pattern
```html
<!-- Pin exact versions -->
<script src="https://cdn.tailwindcss.com/3.4.1"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
```

#### ❌ Incorrect Pattern
```html
<!-- NEVER do this - will auto-update -->
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

#### CDN Version Format
- **Tailwind Play CDN:** `/version` - Example: `cdn.tailwindcss.com/3.4.1`
- **jsDelivr:** `@version` - Example: `chart.js@4.5.1`
- **unpkg:** `@version` - Example: `react@18.2.0`
- **cdnjs:** `/version/` - Example: `ajax/libs/jquery/3.7.1/jquery.min.js`

### 2. Node.js Applications (npm Dependencies)

**Use package-lock.json and pin critical dependencies.**

#### package.json Version Ranges

```json
{
  "dependencies": {
    // ✅ Pin exact versions for critical/breaking-prone packages
    "chart.js": "4.5.1",
    "prisma": "5.22.0",

    // ✅ Allow patch updates for stable packages
    "express": "~4.18.2",  // Allows 4.18.x (patch only)

    // ⚠️  Use with caution - allows minor updates
    "helmet": "^7.1.0",    // Allows 7.x.x (minor + patch)

    // ❌ NEVER use for production
    "some-lib": "*"        // Dangerous - any version
  }
}
```

#### Version Prefix Guide
- **No prefix** (e.g., `4.5.1`) - Exact version only
- **~** (e.g., `~4.5.1`) - Allows patch updates (4.5.x)
- **^** (e.g., `^4.5.1`) - Allows minor updates (4.x.x)
- **\*** - Any version (NEVER use)

#### Critical Packages to Pin Exactly
- Database ORMs (Prisma, TypeORM, Sequelize)
- Authentication libraries (jsonwebtoken, passport)
- Chart/visualization libraries
- Framework core packages (if using specific features)
- Any package with frequent breaking changes

#### Always Use package-lock.json
```bash
# ✅ Install with lock file
npm install

# ✅ Update with lock file
npm update

# ❌ NEVER delete package-lock.json
# It ensures reproducible builds
```

### 3. Build Tools & Dev Dependencies

Build tools can be more flexible but should still be controlled:

```json
{
  "devDependencies": {
    // ✅ Can use ^ for build tools (more flexibility)
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0",

    // ✅ Pin linters/formatters for consistency
    "prettier": "3.1.1",
    "eslint": "8.56.0"
  }
}
```

---

## Current Dependency Audit (October 2025)

### Static Sites

#### ✅ weights.benloe.com
- Tailwind CSS: `3.4.1` (pinned)
- Chart.js: `4.5.1` (pinned)
- chartjs-adapter-date-fns: `3.0.0` (pinned)

#### ✅ benloe.com
- No CDN dependencies (all inline CSS)

### Node.js Applications

#### ✅ artanis-auth
- Uses package-lock.json
- Prisma: Pinned in package.json
- All dependencies managed via npm

#### ✅ weights-api
- Uses package-lock.json
- Prisma: Pinned in package.json
- All dependencies managed via npm

#### ✅ gamenight-api
- Uses package-lock.json
- Prisma: Pinned in package.json
- All dependencies managed via npm

#### ✅ gamenight-frontend
- Vite build process bundles all dependencies
- No runtime CDN dependencies

---

## Maintenance Procedures

### When Adding New CDN Dependencies

1. **Research the current stable version**
   ```bash
   # Check latest version on npm
   npm view package-name version
   ```

2. **Pin the exact version in HTML**
   ```html
   <script src="https://cdn.jsdelivr.net/npm/package-name@X.Y.Z"></script>
   ```

3. **Document in code comments**
   ```html
   <!-- Chart.js v4.5.1 - Pinned Oct 2025. Check for updates quarterly. -->
   <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1"></script>
   ```

4. **Add to this document** under "Current Dependency Audit"

### When Updating CDN Dependencies

1. **Test in development first**
   - Create a test HTML file with new version
   - Test all functionality thoroughly

2. **Check for breaking changes**
   - Read the changelog/migration guide
   - Look for "BREAKING" changes

3. **Update version and test**
   ```html
   <!-- Before -->
   <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1"></script>

   <!-- After testing -->
   <script src="https://cdn.jsdelivr.net/npm/chart.js@4.6.0"></script>
   ```

4. **Update documentation**
   - Update version in this file
   - Add comment with update date

### When Updating npm Dependencies

```bash
# 1. Check what's outdated
npm outdated

# 2. Update non-breaking (patch/minor if using ^ or ~)
npm update

# 3. For major updates, do one at a time
npm install package-name@latest

# 4. Test thoroughly
npm run build
npm run test  # if tests exist

# 5. Commit package.json AND package-lock.json
git add package.json package-lock.json
git commit -m "chore: update dependencies"
```

### Quarterly Dependency Review

**Schedule:** First week of January, April, July, October

1. **Review all CDN dependencies**
   - Check for security advisories
   - Check for new major versions
   - Evaluate if update is worth the effort

2. **Review npm dependencies**
   ```bash
   npm outdated
   npm audit
   ```

3. **Document decisions**
   - If staying on old version, document why
   - If updating, test thoroughly

---

## Emergency Procedures

### If a Dependency Breaks Production

1. **Identify the culprit**
   - Check browser console for errors
   - Check recent commits
   - Compare with last working version

2. **Immediate rollback**
   ```bash
   # Revert the HTML/package.json to working version
   git checkout HEAD~1 path/to/file.html
   git commit -m "revert: rollback breaking dependency"
   ```

3. **Pin the version**
   - If it was unpinned, pin to last working version
   - Document the incident

4. **Root cause analysis**
   - What changed?
   - Why wasn't it caught?
   - Update this document with lessons learned

---

## Tools & Resources

### Version Checking Tools

- **npm view**: Check npm package versions
  ```bash
  npm view chart.js versions --json
  ```

- **jsDelivr Version List**: `https://www.jsdelivr.com/package/npm/package-name?tab=versions`

- **Can I Use**: Check browser compatibility - https://caniuse.com

### Helpful Commands

```bash
# Check all outdated npm packages
npm outdated

# Check for security vulnerabilities
npm audit

# Update package-lock without changing package.json
npm install

# See what npm would install
npm install --dry-run

# Check what files will be included in git commit
git status
```

---

## Philosophy

**"Boring is better than broken."**

- Stability > Latest features
- Explicit > Implicit
- Tested > Untested
- Documented > Undocumented

When in doubt, **pin the version**.
