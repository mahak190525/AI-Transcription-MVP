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

// Store active sessions and their accumulated transcripts
const activeSessions = new Map();

export const handler = async (event, context) => {
  // Handle CORS
  const origin = event.headers.origin || event.headers.Origin;
  const allowedOrigins = [
    'https://ai-teleprompt.netlify.app',
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

  try {
    const { transcript, action, sessionId, audioData } = JSON.parse(event.body);

    // Handle different actions for real-time transcription
    if (action === 'start') {
      // Start a new transcription session
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Initialize session
      activeSessions.set(newSessionId, {
        transcript: '',
        partialTranscript: '',
        audioChunks: [],
        lastProcessed: Date.now()
      });
      
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: newSessionId,
          message: 'Real-time transcription session started'
        }),
      };
    }

    if (action === 'audio') {
      // Process real audio data with AssemblyAI
      if (!ASSEMBLYAI_API_KEY) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'AssemblyAI API key not configured' }),
        };
      }

      if (!sessionId || !activeSessions.has(sessionId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid session ID' }),
        };
      }

      const session = activeSessions.get(sessionId);

      try {
        // Convert base64 audio to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');
        
        // Add to session's audio chunks
        session.audioChunks.push(audioBuffer);
        
        // Process accumulated audio if enough time has passed (batch processing)
        const now = Date.now();
        if (now - session.lastProcessed > 2000) { // Process every 2 seconds
          session.lastProcessed = now;
          
          // Combine all audio chunks
          const combinedAudio = Buffer.concat(session.audioChunks);
          session.audioChunks = []; // Clear processed chunks
          
          // Upload to AssemblyAI
          const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
              'Authorization': ASSEMBLYAI_API_KEY,
              'Content-Type': 'application/octet-stream'
            },
            body: combinedAudio
          });

          if (!uploadResponse.ok) {
            throw new Error('Failed to upload audio to AssemblyAI');
          }

          const { upload_url } = await uploadResponse.json();

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
            throw new Error('Failed to create transcription job');
          }

          const { id: transcriptId } = await transcriptResponse.json();

          // Poll for results (with timeout)
          let attempts = 0;
          const maxAttempts = 15; // 15 seconds max
          
          while (attempts < maxAttempts) {
            const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
              headers: {
                'Authorization': ASSEMBLYAI_API_KEY
              }
            });

            const result = await statusResponse.json();
            
            if (result.status === 'completed') {
              const newText = result.text || '';
              if (newText.trim()) {
                // Add to session transcript
                session.transcript += (session.transcript ? ' ' : '') + newText;
                session.partialTranscript = '';
                
                return {
                  statusCode: 200,
                  headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    sessionId: sessionId,
                    transcript: newText,
                    fullTranscript: session.transcript,
                    partialTranscript: '',
                    isFinal: true
                  }),
                };
              }
              break;
            } else if (result.status === 'error') {
              throw new Error('Transcription failed: ' + result.error);
            }
            
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
        }

        // Return current state (no new transcription yet)
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: sessionId,
            transcript: '',
            fullTranscript: session.transcript,
            partialTranscript: 'Listening...',
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
      // Clean up session
      if (sessionId && activeSessions.has(sessionId)) {
        activeSessions.delete(sessionId);
      }
      
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
    console.error('Error in transcribe-stream function:', error);
    
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
