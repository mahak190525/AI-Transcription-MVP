let ws = null;
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
// testBtn.addEventListener('click', testTranscript);
// promoteBtn.addEventListener('click', promotePartialToStable);
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = async () => {
      updateStatus('🔴 Recording... Speak into your microphone', true);

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

      processor.port.onmessage = (e) => {
        if (e.data.type === 'audioData' && ws && ws.readyState === WebSocket.OPEN) {
          const inputData = e.data.audioData;
          const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
          const pcmData = floatTo16BitPCM(downsampled);
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData)));

          ws.send(JSON.stringify({
            type: 'audio',
            audio: base64Audio
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      ws.send(JSON.stringify({ type: 'start' }));

      startBtn.disabled = true;
      stopBtn.disabled = false;
      generateBtn.disabled = false;
      generateSelectedBtn.disabled = true;
      generateSelectedBtn.style.opacity = '0.5';

      stableTranscript = '';
      partialTranscript = '';
      updateTranscript();
      answerBox.classList.remove('show');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'transcript') {
        console.log('Transcript received:', data);
        if (data.isFinal) {
          stableTranscript += (stableTranscript ? ' ' : '') + data.text;
          partialTranscript = '';
          console.log('Updated stableTranscript:', stableTranscript);
        } else {
          partialTranscript = data.text;
          console.log('Updated partialTranscript:', partialTranscript);
          
          // Clear existing timeout
          if (partialTranscriptTimeout) {
            clearTimeout(partialTranscriptTimeout);
          }
          
          // Set timeout to promote partial to stable after 3 seconds of no updates
          partialTranscriptTimeout = setTimeout(() => {
            promotePartialToStable();
          }, 3000);
        }
        updateTranscript();
      } else if (data.type === 'answer') {
        // Clear timeout if it exists
        if (window.currentTimeoutId) {
          clearTimeout(window.currentTimeoutId);
          window.currentTimeoutId = null;
        }
        
        answerEl.textContent = data.text;
        answerBox.classList.add('show');
        loadingSpinner.style.display = 'none';
      } else if (data.type === 'error') {
        // Clear timeout if it exists
        if (window.currentTimeoutId) {
          clearTimeout(window.currentTimeoutId);
          window.currentTimeoutId = null;
        }
        
        updateStatus('Error: ' + data.message, false);
        loadingSpinner.style.display = 'none';
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateStatus('Connection error', false);
      stopCapture();
    };

    ws.onclose = () => {
      updateStatus('Connection closed', false);
      stopCapture();
    };

  } catch (error) {
    console.error('Error starting capture:', error);
    updateStatus('Failed to access microphone. Please grant permission.', false);
  }
}

function stopCapture() {
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
      await fetch('/.netlify/functions/transcribe', {
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

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }));
    ws.close();
  }

  ws = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  generateBtn.disabled = true;
  generateSelectedBtn.disabled = true;
  generateSelectedBtn.style.opacity = '0.5';

  updateStatus('Capture stopped', false);
  isRecording = false;
}

function generateAnswer() {
  console.log('=== GENERATE ANSWER DEBUG ===');
  console.log('WebSocket state:', ws ? ws.readyState : 'null');
  console.log('WebSocket OPEN state:', ws ? (ws.readyState === WebSocket.OPEN) : 'null');
  console.log('stableTranscript:', JSON.stringify(stableTranscript));
  console.log('stableTranscript length:', stableTranscript.length);
  console.log('stableTranscript trimmed:', JSON.stringify(stableTranscript.trim()));
  console.log('stableTranscript trimmed length:', stableTranscript.trim().length);
  console.log('partialTranscript:', JSON.stringify(partialTranscript));
  console.log('=============================');

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    updateStatus('Not connected', false);
    return;
  }

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

  const transcriptData = {
    type: 'generate',
    transcript: fullTranscript
  };
  
  console.log('Sending transcript data:', transcriptData);
  ws.send(JSON.stringify(transcriptData));
}

function handleTextSelection() {
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  
  // Check if the selection is within the transcript element
  let container = range.commonAncestorContainer;
  while (container && container !== transcriptEl) {
    container = container.parentNode;
  }
  
  // Only handle selection if it's within the transcript element
  if (container === transcriptEl) {
    const selectedText = selection.toString().trim();
    console.log('Text selection changed:', selectedText);
    
    if (selectedText && selectedText.length > 0) {
      generateSelectedBtn.disabled = false;
      generateSelectedBtn.style.opacity = '1';
    } else {
      generateSelectedBtn.disabled = true;
      generateSelectedBtn.style.opacity = '0.5';
    }
  } else {
    // Selection is outside transcript element
    generateSelectedBtn.disabled = true;
    generateSelectedBtn.style.opacity = '0.5';
  }
}

function generateAnswerForSelection() {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    updateStatus('No text selected.', false);
    return;
  }
  
  const range = selection.getRangeAt(0);
  
  // Create a temporary div to handle HTML content properly
  const tempDiv = document.createElement('div');
  
  // Clone the range contents to preserve the original
  tempDiv.appendChild(range.cloneContents());
  
  // Remove any partial transcript spans
  const partialSpans = tempDiv.getElementsByClassName('partial');
  Array.from(partialSpans).forEach(span => {
    span.remove();
  });
  
  // Get the cleaned text content
  const selectedText = tempDiv.textContent.trim();
  
  console.log('=== GENERATE ANSWER FOR SELECTION DEBUG ===');
  console.log('Raw selected text:', JSON.stringify(selectedText));
  console.log('Selected text length:', selectedText.length);
  
  // Get the selected range's start and end containers
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  
  // Verify the selection is within the transcript element
  let isWithinTranscript = false;
  let current = startContainer;
  while (current && current !== document.body) {
    if (current === transcriptEl) {
      isWithinTranscript = true;
      break;
    }
    current = current.parentNode;
  }
  
  console.log('Selection within transcript:', isWithinTranscript);
  console.log('Start container:', startContainer.nodeType, startContainer.textContent);
  console.log('End container:', endContainer.nodeType, endContainer.textContent);
  
  // Only proceed if selection is within transcript element
  if (!isWithinTranscript) {
    updateStatus('Please select text from the transcript only.', false);
    return;
  }
  
  console.log('WebSocket state:', ws ? ws.readyState : 'null');
  console.log('===========================================');

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    updateStatus('Not connected', false);
    return;
  }

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

  // Double check we're not accidentally getting full transcript
  const allText = transcriptEl.textContent;
  const containsFullTranscript = allText.includes(selectedText) && selectedText.length === allText.length;
  
  if (containsFullTranscript) {
    console.error('Warning: Selected text matches full transcript, this may be an error');
    updateStatus('Error: Selection appears to be full transcript. Please try selecting again.', false);
    return;
  }

  // Prepare the data to send, explicitly stating it's a selection
  const transcriptData = {
    type: 'generate',
    transcript: selectedText,
    isSelection: true  // Add flag to indicate this is selected text
  };
  
  console.log('Sending selected text data:', transcriptData);
  ws.send(JSON.stringify(transcriptData));
}

function testTranscript() {
  console.log('=== TRANSCRIPT TEST ===');
  console.log('stableTranscript:', stableTranscript);
  console.log('stableTranscript length:', stableTranscript.length);
  console.log('stableTranscript trimmed:', stableTranscript.trim());
  console.log('partialTranscript:', partialTranscript);
  console.log('WebSocket state:', ws ? ws.readyState : 'null');
  console.log('========================');
  
  if (stableTranscript.trim()) {
    updateStatus(`Transcript available: ${stableTranscript.length} characters`, true);
  } else {
    updateStatus('No transcript available', false);
  }
}
