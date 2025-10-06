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
      // Start a new transcription session
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const session = {
        id: sessionId,
        transcript: '',
        partialTranscript: '',
        startTime: Date.now(),
        isActive: true
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
          message: 'Transcription session started'
        }),
      };
    }

    if (action === 'audio') {
      // Process audio data
      if (!sessionId || !activeSessions.has(sessionId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid session ID' }),
        };
      }

      const session = activeSessions.get(sessionId);
      
      // Simulate real-time transcription processing
      // In a real implementation, you would send this to AssemblyAI
      // For now, we'll simulate the transcription process
      const mockTranscript = await processAudioData(audioData);
      
      if (mockTranscript) {
        session.partialTranscript = mockTranscript;
        session.transcript += (session.transcript ? ' ' : '') + mockTranscript;
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
          isFinal: true
        }),
      };
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
    console.error('Error in transcribe-realtime function:', error);
    
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

// Simulate audio processing (replace with real AssemblyAI integration)
async function processAudioData(audioData) {
  // This is a mock function - in reality, you would:
  // 1. Send audio data to AssemblyAI real-time API
  // 2. Process the response
  // 3. Return the transcript
  
  // For demo purposes, return a mock transcript
  const mockTranscripts = [
    'what is',
    'generative ai',
    'and explain',
    'the difference',
    'between machine learning',
    'and deep learning'
  ];
  
  // Return a random mock transcript
  return mockTranscripts[Math.floor(Math.random() * mockTranscripts.length)];
}
