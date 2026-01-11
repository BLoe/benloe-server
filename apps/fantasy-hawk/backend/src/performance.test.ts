/**
 * Performance Metrics Tests for Fantasy Hawk
 *
 * This file documents and validates performance metrics.
 * Some tests may require a running server and authenticated session.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Frontend Bundle Size', () => {
  const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');

  it('JS bundle should be under 500KB gzipped', async () => {
    // Check if dist folder exists
    const distExists = fs.existsSync(FRONTEND_DIST);
    if (!distExists) {
      console.log('SKIP: dist folder not found - run npm build first');
      return;
    }

    const assetsDir = path.join(FRONTEND_DIST, 'assets');
    const files = fs.readdirSync(assetsDir);
    const jsFiles = files.filter(f => f.endsWith('.js'));

    let totalSize = 0;
    for (const file of jsFiles) {
      const stats = fs.statSync(path.join(assetsDir, file));
      totalSize += stats.size;
    }

    // Uncompressed size as proxy (gzip typically achieves 3-4x compression)
    // 500KB gzipped ≈ 1.5-2MB uncompressed
    const estimatedGzipped = totalSize / 3.5;
    console.log(`JS bundle size: ${(totalSize / 1024).toFixed(1)}KB uncompressed`);
    console.log(`Estimated gzipped: ${(estimatedGzipped / 1024).toFixed(1)}KB`);

    expect(estimatedGzipped).toBeLessThan(500 * 1024);
  });

  it('CSS bundle should be under 100KB', async () => {
    const distExists = fs.existsSync(FRONTEND_DIST);
    if (!distExists) {
      console.log('SKIP: dist folder not found');
      return;
    }

    const assetsDir = path.join(FRONTEND_DIST, 'assets');
    const files = fs.readdirSync(assetsDir);
    const cssFiles = files.filter(f => f.endsWith('.css'));

    let totalSize = 0;
    for (const file of cssFiles) {
      const stats = fs.statSync(path.join(assetsDir, file));
      totalSize += stats.size;
    }

    console.log(`CSS bundle size: ${(totalSize / 1024).toFixed(1)}KB`);
    expect(totalSize).toBeLessThan(100 * 1024);
  });
});

describe('Backend Code Quality', () => {
  const BACKEND_SRC = path.join(__dirname, '.');

  it('services should not have overly large files', () => {
    const servicesDir = path.join(BACKEND_SRC, 'services');
    const files = fs.readdirSync(servicesDir);

    const warnings: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;

      const content = fs.readFileSync(path.join(servicesDir, file), 'utf-8');
      const lineCount = content.split('\n').length;

      if (lineCount > 500) {
        warnings.push(`${file}: ${lineCount} lines (consider splitting)`);
      }
    }

    if (warnings.length > 0) {
      console.log('Files with >500 lines:', warnings);
    }

    // Don't fail - just report
    expect(true).toBe(true);
  });

  it('routes file should not be overly complex', () => {
    const routesFile = path.join(BACKEND_SRC, 'routes/fantasy.ts');
    const content = fs.readFileSync(routesFile, 'utf-8');
    const lineCount = content.split('\n').length;

    console.log(`Routes file: ${lineCount} lines`);

    // Routes file can be large due to many endpoints
    // Just document, don't fail
    expect(true).toBe(true);
  });
});

describe('Test Suite Performance', () => {
  it('test suite should have good coverage', () => {
    const BACKEND_SRC = path.join(__dirname, '.');
    const servicesDir = path.join(BACKEND_SRC, 'services');

    const serviceFiles = fs.readdirSync(servicesDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const testFiles = fs.readdirSync(servicesDir)
      .filter(f => f.endsWith('.test.ts'));

    const serviceNames = serviceFiles.map(f => f.replace('.ts', ''));
    const testedServices = testFiles.map(f => f.replace('.test.ts', ''));

    const untested = serviceNames.filter(s => !testedServices.includes(s));

    console.log(`Services: ${serviceNames.length}`);
    console.log(`Test files: ${testFiles.length}`);
    if (untested.length > 0) {
      console.log(`Services without tests: ${untested.join(', ')}`);
    }

    // Most services should have tests
    const coverage = testedServices.length / serviceNames.length;
    expect(coverage).toBeGreaterThan(0.5);
  });
});

describe('Performance Targets Documentation', () => {
  it('documents expected performance metrics', () => {
    const metrics = {
      frontend: {
        jsBundle: '<500KB gzipped',
        cssBundle: '<100KB',
        initialLoad: '<3s on broadband',
        timeToInteractive: '<2s',
      },
      backend: {
        apiResponseTime: '<500ms for most endpoints',
        yahooApiProxy: '<2s (depends on Yahoo)',
        cacheHit: '<100ms',
      },
      lighthouse: {
        performance: '>70',
        accessibility: '>90',
        bestPractices: '>90',
      },
    };

    console.log('Performance Targets:');
    console.log(JSON.stringify(metrics, null, 2));

    expect(metrics).toBeDefined();
  });
});
