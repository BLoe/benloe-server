/**
 * Test script for Claude proxy routes
 *
 * Usage:
 *   npx tsx scripts/test-claude-routes.ts
 */

const BASE_URL = 'http://localhost:3002';

// Use an existing valid session token from the database
const VALID_SESSION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbWVxamdiOG8wMDAxd256c3Vyem1mcDZmIiwiZW1haWwiOiJiZWxvdzQxM0BnbWFpbC5jb20iLCJpYXQiOjE3NjYzNjE0NjUsImV4cCI6MTc2ODk1MzQ2NX0.myMwZFt0k-zpa7ygpuvV1TPXrKwP2LKaPYHCokXY4aE';

async function testRoutes() {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Cookie: `token=${VALID_SESSION_TOKEN}`,
  };

  console.log('Testing Claude Proxy Routes');
  console.log('='.repeat(50));

  // Test 1: GET /api/claude/status - Check if key exists
  console.log('\n1. GET /api/claude/status - Check if Claude API key exists');
  try {
    const res = await fetch(`${BASE_URL}/api/claude/status`, { headers });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 2: POST /api/claude/messages - Non-streaming request
  console.log('\n2. POST /api/claude/messages - Non-streaming request');
  try {
    const res = await fetch(`${BASE_URL}/api/claude/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Say hello in exactly 5 words.' }],
        max_tokens: 50,
      }),
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.ok) {
      console.log(`   Response ID: ${data.id}`);
      console.log(`   Model: ${data.model}`);
      console.log(`   Content: ${data.content?.[0]?.text}`);
      console.log(`   Usage: ${JSON.stringify(data.usage)}`);
    } else {
      console.log(`   Error:`, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 3: POST /api/claude/messages/stream - Streaming request
  console.log('\n3. POST /api/claude/messages/stream - Streaming request');
  try {
    const res = await fetch(`${BASE_URL}/api/claude/messages/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
        max_tokens: 100,
      }),
    });
    console.log(`   Status: ${res.status}`);
    console.log(`   Content-Type: ${res.headers.get('content-type')}`);

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      console.log('   Stream events:');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        // Print first 200 chars of accumulated text
        if (fullText.length < 500) {
          process.stdout.write('.');
        }
      }
      console.log(
        '\n   Full response (first 500 chars):',
        fullText.slice(0, 500)
      );
    } else {
      const data = await res.json();
      console.log(`   Error:`, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.log(`   Error:`, e);
  }

  // Test 4: Invalid request - missing messages
  console.log('\n4. POST /api/claude/messages - Invalid request');
  try {
    const res = await fetch(`${BASE_URL}/api/claude/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        // missing messages
      }),
    });
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
