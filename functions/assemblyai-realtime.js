import { GoogleGenerativeAI } from '@google/generative-ai';
import querystring from 'querystring';

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables');
}

if (!ASSEMBLYAI_API_KEY) {
  console.error('Missing ASSEMBLYAI_API_KEY in environment variables');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Store active transcription sessions
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
    const { action, sessionId, audioData, transcript } = JSON.parse(event.body);

    if (action === 'start') {
      // Start a new transcription session with AssemblyAI
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        // Create AssemblyAI real-time session
        const assemblyResponse = await fetch('https://api.assemblyai.com/v2/realtime/token', {
          method: 'POST',
          headers: {
            'Authorization': ASSEMBLYAI_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expires_in: 3600 // 1 hour
          })
        });

        const { token } = await assemblyResponse.json();
        
        const session = {
          id: sessionId,
          transcript: '',
          partialTranscript: '',
          startTime: Date.now(),
          isActive: true,
          assemblyToken: token
        };
        
        activeSessions.set(sessionId, session);
        
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            assemblyToken: token,
            message: 'Real-time transcription session started'
          }),
        };
      } catch (error) {
        console.error('Error starting AssemblyAI session:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to start transcription session' }),
        };
      }
    }

    if (action === 'audio') {
      // Process audio data with AssemblyAI
      if (!sessionId || !activeSessions.has(sessionId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid session ID' }),
        };
      }

      const session = activeSessions.get(sessionId);
      
      try {
        // Send audio to AssemblyAI real-time API
        const assemblyResponse = await fetch('https://api.assemblyai.com/v2/realtime/transcript', {
          method: 'POST',
          headers: {
            'Authorization': session.assemblyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            audio_data: audioData,
            sample_rate: 16000
          })
        });

        const result = await assemblyResponse.json();
        
        if (result.text) {
          session.partialTranscript = result.text;
          if (result.is_final) {
            session.transcript += (session.transcript ? ' ' : '') + result.text;
            session.partialTranscript = '';
          }
        }

        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            transcript: session.transcript,
            partialTranscript: session.partialTranscript,
            isFinal: result.is_final || false
          }),
        };
      } catch (error) {
        console.error('Error processing audio with AssemblyAI:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to process audio' }),
        };
      }
    }

    if (action === 'get_transcript') {
      // Get current transcript
      if (!sessionId || !activeSessions.has(sessionId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid session ID' }),
        };
      }

      const session = activeSessions.get(sessionId);
      
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          transcript: session.transcript,
          partialTranscript: session.partialTranscript,
          isActive: session.isActive
        }),
      };
    }

    if (action === 'stop') {
      // Stop transcription session
      if (sessionId && activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        session.isActive = false;
        
        // Clean up after 5 minutes
        setTimeout(() => {
          activeSessions.delete(sessionId);
        }, 5 * 60 * 1000);
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

    if (action === 'generate_answer') {
      // Generate AI answer for transcript
      if (!transcript || !transcript.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No transcript provided' }),
        };
      }

      console.log('Processing transcript for AI answer:', transcript);

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
${transcript}

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
      body: JSON.stringify({ error: 'Invalid action' }),
    };

  } catch (error) {
    console.error('Error in assemblyai-realtime function:', error);
    
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
