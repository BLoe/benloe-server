/**
 * Test script for encryption service
 *
 * Usage:
 *   npx tsx scripts/test-encryption.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/srv/benloe/.env' });

import { getEncryptionService, EncryptionService } from '../src/services/encryption';

console.log('='.repeat(60));
console.log('Encryption Service Test');
console.log('='.repeat(60));
console.log('');

// Test 1: Basic encryption/decryption
function testBasicEncryption() {
  console.log('TEST 1: Basic Encryption/Decryption');
  console.log('-'.repeat(40));

  try {
    const service = getEncryptionService();
    const testApiKey = 'sk-ant-api03-test1234567890abcdefghijklmnop';

    console.log(`Original: ${testApiKey}`);

    const encrypted = service.encrypt(testApiKey);
    console.log(`Encrypted: ${encrypted}`);
    console.log(`Encrypted length: ${encrypted.length} chars`);

    const decrypted = service.decrypt(encrypted);
    console.log(`Decrypted: ${decrypted}`);

    const matches = testApiKey === decrypted;
    console.log(`Match: ${matches ? 'YES' : 'NO'}`);

    return matches;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 2: Different encryptions produce different ciphertexts (IV randomness)
function testRandomness() {
  console.log('');
  console.log('TEST 2: IV Randomness');
  console.log('-'.repeat(40));

  try {
    const service = getEncryptionService();
    const testApiKey = 'sk-ant-api03-same-key-test';

    const encrypted1 = service.encrypt(testApiKey);
    const encrypted2 = service.encrypt(testApiKey);

    console.log(`Encryption 1: ${encrypted1.slice(0, 40)}...`);
    console.log(`Encryption 2: ${encrypted2.slice(0, 40)}...`);

    const areDifferent = encrypted1 !== encrypted2;
    console.log(`Different ciphertexts: ${areDifferent ? 'YES (good!)' : 'NO (bad!)'}`);

    // Both should decrypt to same value
    const decrypted1 = service.decrypt(encrypted1);
    const decrypted2 = service.decrypt(encrypted2);
    const bothDecrypt = decrypted1 === testApiKey && decrypted2 === testApiKey;
    console.log(`Both decrypt correctly: ${bothDecrypt ? 'YES' : 'NO'}`);

    return areDifferent && bothDecrypt;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 3: Key hint generation
function testKeyHint() {
  console.log('');
  console.log('TEST 3: Key Hint Generation');
  console.log('-'.repeat(40));

  try {
    const testCases = [
      { key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', expected: '...wxyz' },
      { key: 'short', expected: '...hort' },
      { key: 'abc', expected: '****' },
      { key: '', expected: '****' },
    ];

    let allPass = true;
    for (const { key, expected } of testCases) {
      const hint = EncryptionService.generateKeyHint(key);
      const pass = hint === expected;
      console.log(`Key: "${key.slice(0, 20)}${key.length > 20 ? '...' : ''}" -> Hint: "${hint}" ${pass ? '✓' : '✗'}`);
      if (!pass) allPass = false;
    }

    return allPass;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 4: Validation method
function testValidation() {
  console.log('');
  console.log('TEST 4: Service Validation');
  console.log('-'.repeat(40));

  try {
    const service = getEncryptionService();
    const isValid = service.validate();
    console.log(`Service validation: ${isValid ? 'PASS' : 'FAIL'}`);
    return isValid;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 5: Tamper detection (modify ciphertext)
function testTamperDetection() {
  console.log('');
  console.log('TEST 5: Tamper Detection');
  console.log('-'.repeat(40));

  try {
    const service = getEncryptionService();
    const testApiKey = 'sk-ant-api03-tamper-test';

    const encrypted = service.encrypt(testApiKey);

    // Tamper with the ciphertext
    const tamperedBuffer = Buffer.from(encrypted, 'base64');
    tamperedBuffer[tamperedBuffer.length - 1] ^= 0xff; // Flip bits
    const tampered = tamperedBuffer.toString('base64');

    try {
      service.decrypt(tampered);
      console.log('Tampered ciphertext decrypted: FAIL (should have thrown!)');
      return false;
    } catch (e) {
      console.log('Tampered ciphertext rejected: PASS (authentication failed as expected)');
      return true;
    }
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Run all tests
async function main() {
  const results = {
    basicEncryption: testBasicEncryption(),
    randomness: testRandomness(),
    keyHint: testKeyHint(),
    validation: testValidation(),
    tamperDetection: testTamperDetection(),
  };

  console.log('');
  console.log('='.repeat(60));
  console.log('Test Results:');
  console.log('='.repeat(60));
  for (const [test, passed] of Object.entries(results)) {
    console.log(`${test}: ${passed ? 'PASS' : 'FAIL'}`);
  }

  const allPassed = Object.values(results).every(r => r);
  console.log('');
  console.log(allPassed ? 'All tests passed!' : 'Some tests failed.');

  process.exit(allPassed ? 0 : 1);
}

main();
