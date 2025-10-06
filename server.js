import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import querystring from 'querystring';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));
app.use(express.json());

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || 'f202720f68234fd190f9a65e3824ffc8';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const CONNECTION_PARAMS = {
  sampleRate: 16000,
  formatTurns: false
};

const ASSEMBLYAI_ENDPOINT = `wss://streaming.assemblyai.com/v3/ws?${querystring.stringify(CONNECTION_PARAMS)}`;

wss.on('connection', (ws) => {
  console.log('Client connected');

  let dgConnection = null;
  let transcriptBuffer = [];
  let clientTranscript = ''; // Store transcript from client
  const BUFFER_DURATION_MS = 60000;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start') {
        try {
          dgConnection = new WebSocket(ASSEMBLYAI_ENDPOINT, {
            headers: {
              Authorization: ASSEMBLYAI_API_KEY
            }
          });

          dgConnection.on('open', () => {
            console.log('AssemblyAI connection opened');
            ws.send(JSON.stringify({ type: 'started' }));
          });

          dgConnection.on('message', (msg) => {
            try {
              const response = JSON.parse(msg.toString());
              const msgType = response.type;

              if (msgType === 'Begin') {
                console.log(`AssemblyAI session began: ID=${response.id}`);
              } else if (msgType === 'Turn') {
                const transcript = response.transcript || '';
                const isFinal = response.turn_is_formatted;

                console.log('AssemblyAI Turn response:', {
                  transcript: transcript,
                  isFinal: isFinal,
                  turn_is_formatted: response.turn_is_formatted,
                  fullResponse: response
                });

                if (transcript) {
                  ws.send(JSON.stringify({
                    type: 'transcript',
                    text: transcript,
                    isFinal: isFinal
                  }));

                  if (isFinal) {
                    transcriptBuffer.push({
                      text: transcript,
                      timestamp: Date.now()
                    });

                    // Also update client transcript
                    clientTranscript += (clientTranscript ? ' ' : '') + transcript;

                    const cutoff = Date.now() - BUFFER_DURATION_MS;
                    transcriptBuffer = transcriptBuffer.filter(t => t.timestamp > cutoff);
                  }
                }
              } else if (msgType === 'Termination') {
                console.log(`AssemblyAI session terminated`);
              }
            } catch (error) {
              console.error('Error parsing AssemblyAI message:', error);
            }
          });

          dgConnection.on('error', (error) => {
            console.error('AssemblyAI error:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Transcription error' }));
          });

          dgConnection.on('close', () => {
            console.log('AssemblyAI connection closed');
          });
        } catch (error) {
          console.error('Failed to create AssemblyAI connection:', error);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to start transcription' }));
        }
      } else if (data.type === 'audio') {
        if (dgConnection && dgConnection.readyState === WebSocket.OPEN) {
          const audioBuffer = Buffer.from(data.audio, 'base64');
          dgConnection.send(audioBuffer);
        }
      } else if (data.type === 'stop') {
        if (dgConnection) {
          try {
            if (dgConnection.readyState === WebSocket.OPEN) {
              dgConnection.send(JSON.stringify({ type: 'Terminate' }));
              setTimeout(() => {
                if (dgConnection) {
                  dgConnection.close();
                }
              }, 500);
            }
          } catch (error) {
            console.error('Error closing AssemblyAI connection:', error);
          }
          dgConnection = null;
        }
        ws.send(JSON.stringify({ type: 'stopped' }));
      } else if (data.type === 'generate') {
        console.log('=== SERVER GENERATE DEBUG ===');
        console.log('Generate request received');
        console.log('Data received:', JSON.stringify(data, null, 2));
        console.log('Transcript from client:', JSON.stringify(data.transcript));
        console.log('Client transcript stored:', JSON.stringify(clientTranscript));
        console.log('Transcript buffer length:', transcriptBuffer.length);
        console.log('Transcript buffer contents:', transcriptBuffer.map(t => t.text));
        
        // Try multiple sources for transcript
        const fullTranscript = data.transcript || clientTranscript || transcriptBuffer.map(t => t.text).join(' ');
        console.log('Final transcript to analyze:', JSON.stringify(fullTranscript));
        console.log('Final transcript length:', fullTranscript.length);
        console.log('Final transcript trimmed:', JSON.stringify(fullTranscript.trim()));
        console.log('Final transcript trimmed length:', fullTranscript.trim().length);
        console.log('==============================');

        if (!fullTranscript.trim()) {
          console.log('No transcript available, sending error');
          ws.send(JSON.stringify({
            type: 'answer',
            text: 'No transcript available to analyze.'
          }));
          return;
        }

        try {
          console.log('Sending to Gemini...');
          const startTime = Date.now();
          
          // Optimize model configuration for speed
          const model = genAI.getGenerativeModel({ 
            // model: 'gemini-2.5-flash',
            model: 'gemini-2.5-flash-lite',
            generationConfig: {
              temperature: 0.7,
              topP: 0.8,
              topK: 40,
              maxOutputTokens: 1000, // Limit response length for faster generation
            }
          });
          
          // Optimize prompt for faster processing
          const prompt =
          // `Based on this question, provide a concise and crisp answer just like you would answer in an interview:\n\nQuestion: "${fullTranscript}"\n\nAnswer:`;
          `# System Role
          You are a confident, articulate interview assistant powered by the Gemini 2.5 Flash model.

          # Task Specification
          Generate professional, natural-sounding answers to interview questions. Adjust the length and depth based on question type.

          # Input
          ${fullTranscript}

          # Output
          A concise, professional answer to the interview question.
          Anser ONLY in bullet points for clarity and quick pointers.`
          
          console.log('Prompt being sent to Gemini:', prompt);
          console.log('Prompt length:', prompt.length);

          // Add timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 15000)
          );

          const result = await Promise.race([
            model.generateContent(prompt),
            timeoutPromise
          ]);
          
          const response = await result.response;
          const answer = response.text();
          
          const endTime = Date.now();
          console.log(`Gemini response received in ${endTime - startTime}ms`);
          
          ws.send(JSON.stringify({
            type: 'answer',
            text: answer
          }));
        } catch (error) {
          console.error('Gemini error:', error);
          const errorMessage = error.message === 'Request timeout' 
            ? 'Request timed out. Please try again.' 
            : 'Failed to generate answer';
          ws.send(JSON.stringify({
            type: 'error',
            message: errorMessage
          }));
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (dgConnection && dgConnection.readyState === WebSocket.OPEN) {
      try {
        dgConnection.send(JSON.stringify({ type: 'Terminate' }));
        dgConnection.close();
      } catch (error) {
        console.error('Error closing AssemblyAI on client disconnect:', error);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
