#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

console.log('🚀 Preparing for production deployment...');

// Get the site URL from environment or prompt user
const siteUrl = process.env.NETLIFY_SITE_URL || process.argv[2];

if (!siteUrl) {
  console.log('❌ Please provide your Netlify site URL:');
  console.log('   npm run deploy:prod https://your-site.netlify.app');
  console.log('   or set NETLIFY_SITE_URL environment variable');
  process.exit(1);
}

console.log(`📝 Updating configuration for site: ${siteUrl}`);

// Update netlify.toml with actual site URL
const netlifyConfigPath = 'netlify.toml';
let netlifyConfig = fs.readFileSync(netlifyConfigPath, 'utf8');

// Replace placeholder URLs with actual site URL
netlifyConfig = netlifyConfig.replace(/your-site\.netlify\.app/g, siteUrl.replace('https://', '').replace('http://', ''));
netlifyConfig = netlifyConfig.replace(/your-custom-domain\.com/g, siteUrl.replace('https://', '').replace('http://', ''));

fs.writeFileSync(netlifyConfigPath, netlifyConfig);
console.log('✅ Updated netlify.toml with site URL');

// Update transcribe function with actual site URL
const transcribeFunctionPath = 'netlify/functions/transcribe.js';
let transcribeFunction = fs.readFileSync(transcribeFunctionPath, 'utf8');

// Update allowed origins
const allowedOrigins = [
  siteUrl,
  'http://localhost:3000',
  'http://localhost:8888'
].map(url => `'${url}'`).join(',\n    ');

transcribeFunction = transcribeFunction.replace(
  /const allowedOrigins = \[[\s\S]*?\];/,
  `const allowedOrigins = [\n    ${allowedOrigins}\n  ];`
);

fs.writeFileSync(transcribeFunctionPath, transcribeFunction);
console.log('✅ Updated transcribe function with allowed origins');

// Build the project
console.log('🔨 Building project...');
import { execSync } from 'child_process';
execSync('npm run build:netlify', { stdio: 'inherit' });

console.log('🎉 Production deployment ready!');
console.log('');
console.log('📋 Next steps:');
console.log('1. Push your changes to GitHub');
console.log('2. Deploy to Netlify (automatic if connected to GitHub)');
console.log('3. Set environment variables in Netlify dashboard:');
console.log('   - GEMINI_API_KEY=your_api_key_here');
console.log('   - ASSEMBLYAI_API_KEY=your_api_key_here (optional)');
console.log('');
console.log(`🌐 Your site will be available at: ${siteUrl}`);
