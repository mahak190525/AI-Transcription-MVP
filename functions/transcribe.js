import { GoogleGenerativeAI } from '@google/generative-ai';

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables');
}

if (!ASSEMBLYAI_API_KEY) {
  console.error('Missing ASSEMBLYAI_API_KEY in environment variables');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Store active sessions (in-memory for Netlify)
const sessions = new Map();

export const handler = async (event, context) => {
  console.log('=== NETLIFY TRANSCRIBE FUNCTION ===');
  console.log('Method:', event.httpMethod);
  console.log('Timestamp:', new Date().toISOString());
  
  // Strict CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { action, sessionId, audioData, transcript } = requestData;
    console.log('Action:', action, 'SessionId:', sessionId);

    // === SESSION START ===
    if (action === 'start') {
      const newSessionId = `netlify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      sessions.set(newSessionId, {
        transcript: '',
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      
      console.log('✅ Session created:', newSessionId);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          sessionId: newSessionId,
          message: 'Transcription session started',
          timestamp: new Date().toISOString()
        })
      };
    }

    // === AUDIO PROCESSING ===
    if (action === 'audio') {
      console.log('🎤 Processing audio...');
      
      // Validate session
      if (!sessionId || !sessions.has(sessionId)) {
        console.error('❌ Invalid session:', sessionId);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid or expired session' })
        };
      }

      // Validate API key
      if (!ASSEMBLYAI_API_KEY) {
        console.error('❌ AssemblyAI API key missing');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Transcription service not configured' })
        };
      }

      // Validate audio data
      if (!audioData || typeof audioData !== 'string') {
        console.error('❌ Invalid audio data');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid audio data' })
        };
      }

      const session = sessions.get(sessionId);
      session.lastActivity = Date.now();

      try {
        // Step 1: Parse base64 audio data
        console.log('📝 Parsing base64 audio...');
        let audioBuffer;
        try {
          audioBuffer = Buffer.from(audioData, 'base64');
        } catch (base64Error) {
          console.error('❌ Base64 decode error:', base64Error);
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid base64 audio data' })
          };
        }

        console.log('📊 Audio buffer size:', audioBuffer.length, 'bytes');

        if (audioBuffer.length === 0) {
          console.error('❌ Empty audio buffer');
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Empty audio data' })
          };
        }

        // Step 2: Create proper WAV file
        console.log('🔧 Creating WAV file...');
        const wavBuffer = createProperWavFile(audioBuffer);
        console.log('📊 WAV file size:', wavBuffer.length, 'bytes');

        // Step 3: Upload to AssemblyAI
        console.log('⬆️ Uploading to AssemblyAI...');
        const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
          method: 'POST',
          headers: {
            'Authorization': ASSEMBLYAI_API_KEY,
            'Content-Type': 'application/octet-stream'
          },
          body: wavBuffer
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('❌ Upload failed:', uploadResponse.status, errorText);
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }

        const uploadResult = await uploadResponse.json();
        const { upload_url } = uploadResult;
        console.log('✅ Upload successful, URL:', upload_url);

        // Step 4: Create transcription job
        console.log('🚀 Creating transcription job...');
        const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: {
            'Authorization': ASSEMBLYAI_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            audio_url: upload_url,
            speech_model: 'best',
            language_code: 'en',
            punctuate: true,
            format_text: true
          })
        });

        if (!transcriptResponse.ok) {
          const errorText = await transcriptResponse.text();
          console.error('❌ Transcription job creation failed:', transcriptResponse.status, errorText);
          throw new Error(`Transcription job failed: ${transcriptResponse.status}`);
        }

        const transcriptResult = await transcriptResponse.json();
        const { id: transcriptId } = transcriptResult;
        console.log('✅ Transcription job created:', transcriptId);

        // Step 5: Poll for results (Netlify-safe polling)
        console.log('⏳ Polling for transcription results...');
        const startTime = Date.now();
        const maxWaitTime = 25000; // 25 seconds max (Netlify function timeout is 26s)
        const pollInterval = 1000; // 1 second intervals
        
        while (Date.now() - startTime < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: { 'Authorization': ASSEMBLYAI_API_KEY }
          });

          if (!statusResponse.ok) {
            console.error('❌ Status check failed:', statusResponse.status);
            continue;
          }

          const result = await statusResponse.json();
          const elapsed = Date.now() - startTime;
          console.log(`⏱️ Poll ${Math.floor(elapsed/1000)}s: Status = ${result.status}`);
          
          if (result.status === 'completed') {
            const transcriptText = result.text || '';
            console.log('✅ Transcription completed:', transcriptText.substring(0, 100) + '...');
            
            // Update session
            if (transcriptText.trim()) {
              session.transcript += (session.transcript ? ' ' : '') + transcriptText;
            }
            
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                sessionId,
                transcript: transcriptText,
                fullTranscript: session.transcript,
                isFinal: true,
                processingTime: elapsed,
                timestamp: new Date().toISOString()
              })
            };
          } 
          
          if (result.status === 'error') {
            console.error('❌ Transcription error:', result.error);
            throw new Error(`Transcription failed: ${result.error}`);
          }
          
          // Status is 'queued' or 'processing' - continue polling
        }

        // Timeout reached
        console.log('⏰ Transcription timeout reached');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            sessionId,
            transcript: '',
            fullTranscript: session.transcript,
            partialTranscript: 'Processing audio... (this may take a moment)',
            isFinal: false,
            timeout: true,
            timestamp: new Date().toISOString()
          })
        };

      } catch (audioError) {
        console.error('❌ Audio processing error:', audioError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Audio processing failed',
            message: audioError.message,
            timestamp: new Date().toISOString()
          })
        };
      }
    }

    // === SESSION STOP ===
    if (action === 'stop') {
      console.log('🛑 Stopping session:', sessionId);
      
      if (sessionId && sessions.has(sessionId)) {
        sessions.delete(sessionId);
        console.log('✅ Session cleaned up');
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'Session stopped',
          timestamp: new Date().toISOString()
        })
      };
    }

    // === AI ANSWER GENERATION ===
    if (action === 'generate_answer' || transcript) {
      console.log('🤖 Generating AI answer...');
      
      const textToAnalyze = transcript || '';
      
      if (!textToAnalyze.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No transcript provided for analysis' })
        };
      }

      if (!GEMINI_API_KEY) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'AI service not configured' })
        };
      }

      try {
        const model = genAI.getGenerativeModel({ 
          model: 'gemini-2.5-flash-lite',
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1000,
          }
        });
        
        const prompt = `# System Role
You are a confident, articulate interview assistant powered by the Gemini 2.5 Flash model.

# Task Specification
Generate professional, natural-sounding answers to interview questions. Adjust the length and depth based on question type.

# Input
${textToAnalyze}

# Output
A concise, professional answer to the interview question.
Answer ONLY in bullet points for clarity and quick pointers.`;

        console.log('🚀 Sending to Gemini...');
        const startTime = Date.now();
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();
        
        const processingTime = Date.now() - startTime;
        console.log(`✅ Gemini response received in ${processingTime}ms`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            answer: answer,
            processingTime: processingTime,
            timestamp: new Date().toISOString()
          })
        };
        
      } catch (geminiError) {
        console.error('❌ Gemini error:', geminiError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'AI processing failed',
            message: geminiError.message,
            timestamp: new Date().toISOString()
          })
        };
      }
    }

    // Invalid action
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'Invalid action',
        validActions: ['start', 'audio', 'stop', 'generate_answer'],
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// === HELPER FUNCTIONS ===

/**
 * Creates a proper WAV file from PCM audio data
 * This ensures AssemblyAI can properly process the audio
 */
function createProperWavFile(pcmBuffer) {
  // Audio specifications
  const sampleRate = 16000;    // 16kHz sample rate
  const channels = 1;          // Mono audio
  const bitsPerSample = 16;    // 16-bit PCM
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;
  
  // Create WAV header (44 bytes)
  const header = Buffer.alloc(44);
  
  // RIFF chunk descriptor
  header.write('RIFF', 0, 4, 'ascii');           // ChunkID
  header.writeUInt32LE(fileSize, 4);              // ChunkSize
  header.write('WAVE', 8, 4, 'ascii');           // Format
  
  // fmt sub-chunk
  header.write('fmt ', 12, 4, 'ascii');          // Subchunk1ID
  header.writeUInt32LE(16, 16);                   // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20);                    // AudioFormat (PCM = 1)
  header.writeUInt16LE(channels, 22);             // NumChannels
  header.writeUInt32LE(sampleRate, 24);          // SampleRate
  header.writeUInt32LE(byteRate, 28);            // ByteRate
  header.writeUInt16LE(blockAlign, 32);          // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34);       // BitsPerSample
  
  // data sub-chunk
  header.write('data', 36, 4, 'ascii');          // Subchunk2ID
  header.writeUInt32LE(dataSize, 40);            // Subchunk2Size
  
  // Combine header + audio data
  return Buffer.concat([header, pcmBuffer]);
}

// Clean up old sessions periodically (Netlify function memory management)
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > maxAge) {
      sessions.delete(sessionId);
      console.log('🧹 Cleaned up old session:', sessionId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes