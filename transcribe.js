import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Helper function to create WAV header
function createWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
  const buffer = Buffer.alloc(44);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  
  // Format chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20); // Audio format (PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // Byte rate
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32); // Block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // Data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

export const handler = async (event, context) => {
  console.log('=== NETLIFY FUNCTION CALLED ===');
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);
  console.log('================================');
  
  // Handle CORS with proper headers for production
  const origin = event.headers.origin || event.headers.Origin;
  const allowedOrigins = [
    'https://ai-teleprompt.netlify.app',
    'https://your-custom-domain.com',
    'http://localhost:3000',
    'http://localhost:8888'
  ];
  
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
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
    const { transcript, action, sessionId, audioData } = JSON.parse(event.body);

    // Handle different actions for real-time transcription
    if (action === 'start') {
      // Start a new transcription session
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: newSessionId,
          message: 'Transcription session started'
        }),
      };
    }

    if (action === 'audio') {
      // Process real audio data with AssemblyAI
      console.log('Audio action received, processing with AssemblyAI...');
      
      if (!ASSEMBLYAI_API_KEY) {
        console.error('AssemblyAI API key not configured');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'AssemblyAI API key not configured' }),
        };
      }

      try {
        console.log('Converting base64 audio data...');
        // Convert base64 audio to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');
        console.log('Audio buffer size:', audioBuffer.length);
        
        // For real-time processing, we'll use a simpler approach
        // Create a WAV header for the PCM data
        const wavHeader = createWavHeader(audioBuffer.length, 16000, 1, 16);
        const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);
        
        console.log('Uploading audio to AssemblyAI...');
        // Upload to AssemblyAI
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
          throw new Error('Failed to upload audio to AssemblyAI: ' + errorText);
        }

        const { upload_url } = await uploadResponse.json();
        console.log('Audio uploaded successfully, creating transcription job...');

        // Create transcription job
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
          console.error('Transcription job creation failed:', errorText);
          throw new Error('Failed to create transcription job: ' + errorText);
        }

        const { id: transcriptId } = await transcriptResponse.json();
        console.log('Transcription job created:', transcriptId);

        // Poll for results with shorter intervals for faster response
        let attempts = 0;
        const maxAttempts = 20; // Increased attempts
        
        while (attempts < maxAttempts) {
          console.log(`Polling attempt ${attempts + 1}/${maxAttempts}...`);
          
          const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: {
              'Authorization': ASSEMBLYAI_API_KEY
            }
          });

          const result = await statusResponse.json();
          console.log('Transcription status:', result.status);
          
          if (result.status === 'completed') {
            const transcriptText = result.text || '';
            console.log('Transcription completed:', transcriptText);
            
            return {
              statusCode: 200,
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sessionId: sessionId,
                transcript: transcriptText,
                fullTranscript: transcriptText,
                partialTranscript: '',
                isFinal: true
              }),
            };
          } else if (result.status === 'error') {
            console.error('Transcription error:', result.error);
            throw new Error('Transcription failed: ' + result.error);
          }
          
          // Wait before next attempt (shorter interval)
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }

        // If we get here, transcription is still processing
        console.log('Transcription still processing after max attempts');
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: sessionId,
            transcript: '',
            fullTranscript: '',
            partialTranscript: 'Processing audio...',
            isFinal: false
          }),
        };

      } catch (error) {
        console.error('AssemblyAI transcription error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Transcription failed', 
            message: error.message 
          }),
        };
      }
    }

    if (action === 'stop') {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Transcription session stopped'
        }),
      };
    }

    if (action === 'generate_answer' || transcript) {
      // Handle AI answer generation
      const textToAnalyze = transcript || '';
      
      if (!textToAnalyze.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No transcript provided' }),
        };
      }

      console.log('Processing transcript:', textToAnalyze);

      // Optimize model configuration for speed
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 1000,
        }
      });
      
      // Optimize prompt for faster processing
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
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answer: answer,
          processingTime: endTime - startTime
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action or missing transcript' }),
    };
  } catch (error) {
    console.error('Error processing transcript:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process transcript',
        message: error.message 
      }),
    };
  }
};
