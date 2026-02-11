/**
 * Script to trigger embedding regeneration
 * Run this after deploying the new embedding system
 * 
 * Usage: node scripts/regenerate-embeddings.js
 * Or call the API endpoint directly: POST /api/emails/regenerate-embeddings
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔧 Embedding Regeneration Script');
console.log('================================\n');
console.log('This will regenerate embeddings for all emails missing ownerEmail.');
console.log('This ensures account-specific AI learning works correctly.\n');

rl.question('Continue? (y/n): ', async (answer) => {
  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpoint = `${baseUrl}/api/emails/regenerate-embeddings`;

  console.log(`\n📡 Calling: ${endpoint}`);
  console.log('Processing...\n');

  try {
    // Note: In production, you'd need to pass authentication
    // For now, this is a reference - call the endpoint from your app with proper auth
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auto: true,
        onlyMissingOwnerEmail: true,
        limit: 1000,
      }),
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log(`Processed: ${result.processed}`);
      console.log(`Errors: ${result.errors}`);
      console.log(`Total: ${result.total}`);
      if (result.remaining) {
        console.log(`\n⚠️  ${result.remaining} emails remaining. Call the endpoint again to continue.`);
      }
    } else {
      console.log('❌ Error:', result.error);
      if (result.details) {
        console.log('Details:', result.details);
      }
    }
  } catch (error) {
    console.error('❌ Failed to call endpoint:', error.message);
    console.log('\n💡 Tip: Make sure your server is running and you have proper authentication.');
    console.log('   You can also call the endpoint directly from your app with:');
    console.log('   POST /api/emails/regenerate-embeddings');
    console.log('   Body: { "auto": true, "onlyMissingOwnerEmail": true, "limit": 1000 }');
  }

  rl.close();
});

