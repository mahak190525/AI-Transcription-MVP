#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

console.log('Building for Netlify deployment...');

// Copy the Netlify-specific files to the public directory
const filesToCopy = [
  { src: 'public/index-netlify.html', dest: 'public/index.html' },
  { src: 'public/app-netlify.js', dest: 'public/app.js' }
];

filesToCopy.forEach(({ src, dest }) => {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✅ Copied ${src} to ${dest}`);
  } else {
    console.log(`⚠️  Source file not found: ${src}`);
  }
});

// Create a simple audio processor for demo purposes
const audioProcessorContent = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputData = input[0];
      for (let i = 0; i < inputData.length; i++) {
        this.buffer[this.bufferIndex] = inputData[i];
        this.bufferIndex++;
        
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: 'audioData',
            audioData: this.buffer.slice()
          });
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;

fs.writeFileSync('public/audio-processor.js', audioProcessorContent);
console.log('✅ Created audio-processor.js for demo');

console.log('🎉 Netlify build completed!');
console.log('📁 Files ready for deployment in the public/ directory');
