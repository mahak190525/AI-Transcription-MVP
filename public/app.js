let audioContext = null;
let audioStream = null;
let processor = null;
let stableTranscript = '';
let partialTranscript = '';
let partialTranscriptTimeout = null;
let currentSessionId = null;
let isRecording = false;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const generateBtn = document.getElementById('generateBtn');
const testBtn = document.getElementById('testBtn');
const promoteBtn = document.getElementById('promoteBtn');
const generateSelectedBtn = document.getElementById('generateSelectedBtn');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const answerBox = document.getElementById('answerBox');
const answerEl = document.getElementById('answer');
const loadingSpinner = document.getElementById('loadingSpinner');

startBtn.addEventListener('click', startCapture);
stopBtn.addEventListener('click', stopCapture);
generateBtn.addEventListener('click', generateAnswer);
testBtn.addEventListener('click', testTranscript);
promoteBtn.addEventListener('click', promotePartialToStable);
generateSelectedBtn.addEventListener('click', generateAnswerForSelection);

// Add event listeners for text selection
transcriptEl.addEventListener('mouseup', handleTextSelection);
transcriptEl.addEventListener('keyup', handleTextSelection);

function updateStatus(message, isActive) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (isActive ? 'active' : 'inactive');
}

function updateTranscript() {
  const display = stableTranscript +
    (partialTranscript ? ' <span class="partial">' + partialTranscript + '</span>' : '');
  transcriptEl.innerHTML = display || 'No transcript yet...';
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  
  // Debug: Show transcript length in status
  if (stableTranscript.trim()) {
    console.log('Current transcript length:', stableTranscript.length);
    console.log('Current transcript content:', stableTranscript);
  }
}

function promotePartialToStable() {
  if (partialTranscript.trim()) {
    console.log('Promoting partial transcript to stable:', partialTranscript);
    stableTranscript += (stableTranscript ? ' ' : '') + partialTranscript;
    partialTranscript = '';
    updateTranscript();
  }
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

async function startCapture() {
  try {
    console.log('=== START CAPTURE DEBUG ===');
    console.log('Starting capture process...');
    updateStatus('Requesting microphone access...', true);

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });

    // Start transcription session
    console.log('Starting transcription session...');
    const sessionResponse = await fetch('/.netlify/functions/transcribe-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        action: 'start'
      })
    });

    const sessionData = await sessionResponse.json();
    
    if (!sessionResponse.ok) {
      throw new Error(sessionData.error || 'Failed to start transcription session');
    }

    currentSessionId = sessionData.sessionId;
    console.log('Transcription session started:', currentSessionId);

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Load the audio worklet
    try {
      await audioContext.audioWorklet.addModule('audio-processor.js');
    } catch (error) {
      console.error('Failed to load audio worklet:', error);
      updateStatus('Failed to initialize audio processing', false);
      return;
    }

    const source = audioContext.createMediaStreamSource(audioStream);
    processor = new AudioWorkletNode(audioContext, 'audio-processor');

    processor.port.onmessage = async (e) => {
      if (e.data.type === 'audioData' && currentSessionId) {
        const inputData = e.data.audioData;
        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
        const pcmData = floatTo16BitPCM(downsampled);
        const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData)));

        // Send audio to transcription service
        try {
          console.log('Sending audio chunk to transcription service...');
          const response = await fetch('/.netlify/functions/transcribe-stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            credentials: 'same-origin',
            body: JSON.stringify({
              action: 'audio',
              sessionId: currentSessionId,
              audioData: base64Audio
            })
          });

          const data = await response.json();
          console.log('Transcription response:', data);
          
          if (response.ok) {
            // Handle both new transcript and full transcript
            if (data.transcript && data.transcript.trim()) {
              // New transcript received
              console.log('New transcript received:', data.transcript);
              stableTranscript = data.fullTranscript || stableTranscript;
              partialTranscript = '';
              updateTranscript();
            } else if (data.partialTranscript) {
              // Partial/status update
              partialTranscript = data.partialTranscript;
              updateTranscript();
            }
          } else {
            console.error('Transcription error:', data.error);
          }
        } catch (error) {
          console.error('Error sending audio data:', error);
        }
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    startBtn.disabled = true;
    stopBtn.disabled = false;
    generateBtn.disabled = false;
    generateSelectedBtn.disabled = true;
    generateSelectedBtn.style.opacity = '0.5';

    stableTranscript = '';
    partialTranscript = '';
    updateTranscript();
    answerBox.classList.remove('show');

    updateStatus('🔴 Recording... Speak into your microphone', true);
    isRecording = true;

  } catch (error) {
    console.error('Error starting capture:', error);
    updateStatus('Failed to access microphone. Please grant permission.', false);
  }
}

async function stopCapture() {
  // Promote any remaining partial transcript to stable
  promotePartialToStable();
  
  // Clear any pending timeout
  if (partialTranscriptTimeout) {
    clearTimeout(partialTranscriptTimeout);
    partialTranscriptTimeout = null;
  }

  // Stop transcription session
  if (currentSessionId) {
    try {
      console.log('Stopping transcription session...');
      await fetch('/.netlify/functions/transcribe-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'stop',
          sessionId: currentSessionId
        })
      });
    } catch (error) {
      console.error('Error stopping transcription session:', error);
    }
    currentSessionId = null;
  }

  if (processor) {
    processor.disconnect();
    processor.port.close();
    processor = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  generateBtn.disabled = true;
  generateSelectedBtn.disabled = true;
  generateSelectedBtn.style.opacity = '0.5';

  updateStatus('Capture stopped', false);
  isRecording = false;
}

async function generateAnswer() {
  console.log('=== GENERATE ANSWER DEBUG ===');
  console.log('stableTranscript:', JSON.stringify(stableTranscript));
  console.log('stableTranscript length:', stableTranscript.length);
  console.log('stableTranscript trimmed:', JSON.stringify(stableTranscript.trim()));
  console.log('stableTranscript trimmed length:', stableTranscript.trim().length);
  console.log('partialTranscript:', JSON.stringify(partialTranscript));
  console.log('=============================');

  // Promote any partial transcript to stable before generating answer
  if (partialTranscript.trim()) {
    console.log('Promoting partial transcript before generating answer:', partialTranscript);
    promotePartialToStable();
  }

  // Check if we have any transcript to analyze (stable or partial)
  const fullTranscript = stableTranscript.trim() || partialTranscript.trim();
  
  if (!fullTranscript) {
    updateStatus('No transcript available to analyze', false);
    return;
  }

  loadingSpinner.style.display = 'inline-block';
  answerBox.classList.add('show');
  answerEl.textContent = 'Generating response...';
  
  // Add timeout indicator
  const timeoutId = setTimeout(() => {
    answerEl.textContent = 'Still generating... This may take a moment.';
  }, 3000);
  
  // Store timeout ID for cleanup
  window.currentTimeoutId = timeoutId;

  try {
    const response = await fetch('/.netlify/functions/transcribe-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        action: 'generate_answer',
        transcript: fullTranscript
      })
    });

    const data = await response.json();

    // Clear timeout if it exists
    if (window.currentTimeoutId) {
      clearTimeout(window.currentTimeoutId);
      window.currentTimeoutId = null;
    }

    if (response.ok) {
      answerEl.textContent = data.answer;
      console.log('Response received in', data.processingTime, 'ms');
    } else {
      updateStatus('Error: ' + data.error, false);
    }
  } catch (error) {
    console.error('Error generating answer:', error);
    updateStatus('Error: Failed to generate answer', false);
  } finally {
    loadingSpinner.style.display = 'none';
  }
}

function handleTextSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  console.log('Text selection changed:', selectedText);
  
  // Enable/disable the "Answer Selected" button based on selection
  if (selectedText && selectedText.length > 0) {
    generateSelectedBtn.disabled = false;
    generateSelectedBtn.style.opacity = '1';
  } else {
    generateSelectedBtn.disabled = true;
    generateSelectedBtn.style.opacity = '0.5';
  }
}

async function generateAnswerForSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  console.log('=== GENERATE ANSWER FOR SELECTION DEBUG ===');
  console.log('Selected text:', JSON.stringify(selectedText));
  console.log('Selected text length:', selectedText.length);
  console.log('===========================================');

  if (!selectedText) {
    updateStatus('No text selected. Please select some text from the transcript.', false);
    return;
  }

  loadingSpinner.style.display = 'inline-block';
  answerBox.classList.add('show');
  answerEl.textContent = 'Generating response for selected text...';
  
  // Add timeout indicator
  const timeoutId = setTimeout(() => {
    answerEl.textContent = 'Still generating... This may take a moment.';
  }, 3000);
  
  // Store timeout ID for cleanup
  window.currentTimeoutId = timeoutId;

  try {
    const response = await fetch('/.netlify/functions/transcribe-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        action: 'generate_answer',
        transcript: selectedText
      })
    });

    const data = await response.json();

    // Clear timeout if it exists
    if (window.currentTimeoutId) {
      clearTimeout(window.currentTimeoutId);
      window.currentTimeoutId = null;
    }

    if (response.ok) {
      answerEl.textContent = data.answer;
      console.log('Response received in', data.processingTime, 'ms');
    } else {
      updateStatus('Error: ' + data.error, false);
    }
  } catch (error) {
    console.error('Error generating answer:', error);
    updateStatus('Error: Failed to generate answer', false);
  } finally {
    loadingSpinner.style.display = 'none';
  }
}

function testTranscript() {
  console.log('=== TRANSCRIPT TEST ===');
  console.log('stableTranscript:', stableTranscript);
  console.log('stableTranscript length:', stableTranscript.length);
  console.log('stableTranscript trimmed:', stableTranscript.trim());
  console.log('partialTranscript:', partialTranscript);
  console.log('Current session ID:', currentSessionId);
  console.log('Is recording:', isRecording);
  console.log('========================');
  
  if (stableTranscript.trim()) {
    updateStatus(`Transcript available: ${stableTranscript.length} characters`, true);
  } else {
    updateStatus('No transcript available', false);
  }
}
