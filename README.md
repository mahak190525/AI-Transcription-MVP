# Live Transcribe AI

Real-time audio transcription using AssemblyAI with AI-powered insights from Google Gemini.

## Features

- Live microphone audio capture
- Real-time transcription with AssemblyAI
- AI-powered response generation using Gemini
- 60-second rolling transcript buffer
- Simple single-page interface

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
ASSEMBLYAI_API_KEY=your_seembly_ai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### Getting API Keys

**AssemblyAI:**
- Sign up at https://www.assemblyai.com/
- Get your API key from the dashboard
- Default key provided: f202720f68234fd190f9a65e3824ffc8

**Google Gemini:**
- Get an API key at https://makersuite.google.com/app/apikey
- Free tier available

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

## Usage

1. Click **Start Capture** to begin recording
2. Speak into your microphone
3. Watch the live transcript appear
4. Click **Generate Answer** to get AI insights on your transcript
5. Click **Stop Capture** when done

## Technical Details

- Frontend: Vanilla HTML/CSS/JS with Web Audio API
- Backend: Node.js + Express + WebSocket
- Transcription: AssemblyAI Streaming API
- AI: Google Gemini Pro
- Audio format: PCM 16-bit linear at 16kHz

## Requirements

- Node.js 18+
- Modern browser with microphone access
- Active internet connection
