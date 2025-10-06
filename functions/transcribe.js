import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const handler = async (event, context) => {
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
    const { transcript } = JSON.parse(event.body);

    if (!transcript || !transcript.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No transcript provided' }),
      };
    }

    console.log('Processing transcript:', transcript);

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
