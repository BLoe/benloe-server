/**
 * Test script for API key management routes
 *
 * Usage:
 *   npx tsx scripts/test-apikeys-routes.ts
 */

const BASE_URL = 'http://localhost:3002';

// Use an existing valid session token from the database
const VALID_SESSION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbWVxamdiOG8wMDAxd256c3Vyem1mcDZmIiwiZW1haWwiOiJiZWxvdzQxM0BnbWFpbC5jb20iLCJpYXQiOjE3NjYzNjE0NjUsImV4cCI6MTc2ODk1MzQ2NX0.myMwZFt0k-zpa7ygpuvV1TPXrKwP2LKaPYHCokXY4aE';

async function testRoutes() {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cookie': `token=${VALID_SESSION_TOKEN}`,
  };

  console.log('Testing API Key Routes');
  console.log('Using session token (first 50 chars):', VALID_SESSION_TOKEN.slice(0, 50) + '...');
  console.log('='.repeat(50));

  // Test 1: GET /api/keys - List keys
  console.log('\n1. GET /api/keys - List keys');
  try {
    const res = await fetch(`${BASE_URL}/api/keys`, {
      headers,
      redirect: 'manual',
    });
    console.log(`   Status: ${res.status}`);
    console.log(`   Headers:`, Object.fromEntries(res.headers.entries()));
    const text = await res.text();
    console.log(`   Response (first 200 chars):`, text.slice(0, 200));
    if (res.status === 200) {
      const data = JSON.parse(text);
      console.log(`   Parsed:`, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 2: GET /api/keys/anthropic/status - Check status
  console.log('\n2. GET /api/keys/anthropic/status - Check if key exists');
  try {
    const res = await fetch(`${BASE_URL}/api/keys/anthropic/status`, { headers });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 3: POST /api/keys/anthropic/test - Test the key
  console.log('\n3. POST /api/keys/anthropic/test - Test the API key');
  try {
    const res = await fetch(`${BASE_URL}/api/keys/anthropic/test`, {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 4: GET /api/keys/openai/status - Check non-existent provider
  console.log('\n4. GET /api/keys/openai/status - Check non-existent provider');
  try {
    const res = await fetch(`${BASE_URL}/api/keys/openai/status`, { headers });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`   Error:`, e);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Tests complete!');
}

testRoutes().catch(console.error);
