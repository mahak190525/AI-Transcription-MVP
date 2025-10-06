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

// Store active sessions
const sessions = new Map();

export const handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { action, sessionId, audioData, transcript } = JSON.parse(event.body);
    console.log('Action:', action);

    // Handle session start
    if (action === 'start') {
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessions.set(newSessionId, {
        transcript: '',
        audioChunks: [],
        lastUpdate: Date.now()
      });
      
      console.log('Session started:', newSessionId);
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: newSessionId,
          message: 'Session started'
        }),
      };
    }

    // Handle audio processing
    if (action === 'audio') {
      console.log('Processing audio for session:', sessionId);
      
      if (!ASSEMBLYAI_API_KEY) {
        console.error('AssemblyAI API key missing');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Transcription service not configured' }),
        };
      }

      if (!sessionId || !sessions.has(sessionId)) {
        console.error('Invalid session ID:', sessionId);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid session' }),
        };
      }

      const session = sessions.get(sessionId);
      
      try {
        // Convert base64 to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');
        console.log('Audio buffer size:', audioBuffer.length);
        
        // Add WAV header for proper audio format
        const wavBuffer = createWavFile(audioBuffer);
        
        // Upload to AssemblyAI
        console.log('Uploading to AssemblyAI...');
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
          console.error('Upload failed:', errorText);
          throw new Error('Upload failed');
        }

        const { upload_url } = await uploadResponse.json();
        console.log('Upload successful, creating transcript...');

        // Create transcription
        const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: {
            'Authorization': ASSEMBLYAI_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            audio_url: upload_url,
            speech_model: 'best',
            language_code: 'en'
          })
        });

        if (!transcriptResponse.ok) {
          const errorText = await transcriptResponse.text();
          console.error('Transcript creation failed:', errorText);
          throw new Error('Transcript creation failed');
        }

        const { id: transcriptId } = await transcriptResponse.json();
        console.log('Transcript job created:', transcriptId);

        // Poll for results
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: { 'Authorization': ASSEMBLYAI_API_KEY }
          });

          const result = await statusResponse.json();
          console.log(`Attempt ${attempts + 1}: Status = ${result.status}`);
          
          if (result.status === 'completed') {
            const text = result.text || '';
            console.log('Transcription completed:', text);
            
            if (text.trim()) {
              session.transcript += (session.transcript ? ' ' : '') + text;
              session.lastUpdate = Date.now();
            }
            
            return {
              statusCode: 200,
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                transcript: text,
                fullTranscript: session.transcript,
                isFinal: true
              }),
            };
          } else if (result.status === 'error') {
            console.error('Transcription error:', result.error);
            throw new Error('Transcription failed');
          }
          
          attempts++;
        }

        // Timeout
        console.log('Transcription timeout');
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            transcript: '',
            fullTranscript: session.transcript,
            partialTranscript: 'Processing...',
            isFinal: false
          }),
        };

      } catch (error) {
        console.error('Audio processing error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Audio processing failed',
            message: error.message 
          }),
        };
      }
    }

    // Handle session stop
    if (action === 'stop') {
      console.log('Stopping session:', sessionId);
      if (sessionId && sessions.has(sessionId)) {
        sessions.delete(sessionId);
      }
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Session stopped' }),
      };
    }

    // Handle AI answer generation
    if (action === 'generate_answer' || transcript) {
      const textToAnalyze = transcript || '';
      console.log('Generating answer for:', textToAnalyze.substring(0, 100) + '...');
      
      if (!textToAnalyze.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No transcript provided' }),
        };
      }

      if (!GEMINI_API_KEY) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'AI service not configured' }),
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

        console.log('Sending to Gemini...');
        const startTime = Date.now();
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();
        
        const endTime = Date.now();
        console.log(`Gemini response received in ${endTime - startTime}ms`);

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answer: answer,
            processingTime: endTime - startTime
          }),
        };
      } catch (error) {
        console.error('Gemini error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'AI processing failed',
            message: error.message 
          }),
        };
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action' }),
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
    };
  }
};

// Helper function to create WAV file with proper headers
function createWavFile(pcmBuffer) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmBuffer.length;
  
  const header = Buffer.alloc(44);
  
  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  
  // Format chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  
  // Data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  
  return Buffer.concat([header, pcmBuffer]);
}