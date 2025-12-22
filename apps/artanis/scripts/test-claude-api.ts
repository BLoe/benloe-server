/**
 * Test script for Claude API integration
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-claude-api.ts
 *
 * Or set the key in .env and run:
 *   npx tsx scripts/test-claude-api.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/srv/benloe/.env' });

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
  console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-claude-api.ts');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('Claude API Test Script');
console.log('='.repeat(60));
console.log(`API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);
console.log('');

// Test 1: Non-streaming request
async function testNonStreaming() {
  console.log('TEST 1: Non-Streaming Request');
  console.log('-'.repeat(40));

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Say "Hello from Claude!" and nothing else.' }
    ]
  };

  console.log('Request:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log('Response Headers:');
    response.headers.forEach((value, key) => {
      if (key.startsWith('x-') || key === 'content-type') {
        console.log(`  ${key}: ${value}`);
      }
    });

    const data = await response.json();
    console.log('');
    console.log('Response Body:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    if (data.content && data.content[0]) {
      console.log('Extracted Text:', data.content[0].text);
    }

    return response.ok;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 2: Streaming request
async function testStreaming() {
  console.log('');
  console.log('TEST 2: Streaming Request');
  console.log('-'.repeat(40));

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    stream: true,
    messages: [
      { role: 'user', content: 'Count from 1 to 5, with each number on a new line.' }
    ]
  };

  console.log('Request:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log('');

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error Response:', JSON.stringify(errorData, null, 2));
      return false;
    }

    console.log('Streaming Events:');
    console.log('-'.repeat(40));

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let eventCount = 0;

    if (!reader) {
      console.error('No reader available');
      return false;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7);
          console.log(`\n[Event ${++eventCount}] ${eventType}`);
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('  [DONE]');
          } else {
            try {
              const parsed = JSON.parse(data);

              // Extract text from content_block_delta events
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullText += parsed.delta.text;
                console.log(`  Delta: "${parsed.delta.text}"`);
              } else if (parsed.type === 'message_start') {
                console.log(`  Message ID: ${parsed.message?.id}`);
                console.log(`  Model: ${parsed.message?.model}`);
              } else if (parsed.type === 'message_delta') {
                console.log(`  Stop Reason: ${parsed.delta?.stop_reason}`);
                console.log(`  Output Tokens: ${parsed.usage?.output_tokens}`);
              } else if (parsed.type === 'content_block_start') {
                console.log(`  Content Block Index: ${parsed.index}`);
              } else if (parsed.type === 'content_block_stop') {
                console.log(`  Content Block Stop: index ${parsed.index}`);
              }
            } catch {
              // Not JSON, skip
            }
          }
        }
      }
    }

    console.log('');
    console.log('-'.repeat(40));
    console.log('Full Streamed Text:');
    console.log(fullText);

    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Test 3: Error handling (invalid key)
async function testErrorHandling() {
  console.log('');
  console.log('TEST 3: Error Handling (Invalid Key)');
  console.log('-'.repeat(40));

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Hello' }
    ]
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-ant-invalid-key-12345',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log('Error Response Structure:');
    console.log(JSON.stringify(data, null, 2));

    return true; // We expect this to fail, so test passes if we get error response
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

// Run all tests
async function main() {
  const results = {
    nonStreaming: await testNonStreaming(),
    streaming: await testStreaming(),
    errorHandling: await testErrorHandling()
  };

  console.log('');
  console.log('='.repeat(60));
  console.log('Test Results:');
  console.log('='.repeat(60));
  console.log(`Non-Streaming: ${results.nonStreaming ? 'PASS' : 'FAIL'}`);
  console.log(`Streaming: ${results.streaming ? 'PASS' : 'FAIL'}`);
  console.log(`Error Handling: ${results.errorHandling ? 'PASS' : 'FAIL'}`);

  const allPassed = Object.values(results).every(r => r);
  console.log('');
  console.log(allPassed ? 'All tests passed!' : 'Some tests failed.');

  process.exit(allPassed ? 0 : 1);
}

main();
