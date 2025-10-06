# Live Transcribe AI - Deployment Guide

## Netlify Deployment

This project can be deployed to Netlify, but with some limitations due to WebSocket support.

### Prerequisites

1. **Netlify Account**: Sign up at [netlify.com](https://netlify.com)
2. **GitHub Repository**: Push your code to GitHub
3. **Environment Variables**: Set up your API keys

### Deployment Steps

#### 1. Environment Variables

In your Netlify dashboard, go to Site Settings > Environment Variables and add:

```
GEMINI_API_KEY=your_gemini_api_key_here
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here (optional)
```

#### 2. Deploy from GitHub

1. Connect your GitHub repository to Netlify
2. Set build command: `npm install && npm run build`
3. Set publish directory: `public`
4. Deploy!

#### 3. Important Notes

⚠️ **WebSocket Limitation**: Netlify Functions don't support WebSockets directly. The current implementation uses a simplified approach:

- Real-time transcription is simulated
- AI responses work via serverless functions
- For full WebSocket support, consider Vercel, Railway, or Heroku

### Alternative Deployment Options

#### Vercel (Recommended for WebSockets)
```bash
npm install -g vercel
vercel
```

#### Railway
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

#### Heroku
```bash
# Create Procfile
echo "web: node server.js" > Procfile

# Deploy
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or for Netlify local development
npm run netlify:dev
```

### Environment Setup

1. Copy `env.example` to `.env`
2. Add your API keys:
   - Get Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Get AssemblyAI key from [AssemblyAI](https://www.assemblyai.com/) (optional)

### Features

- ✅ AI-powered transcript analysis
- ✅ Text selection for targeted answers
- ✅ Real-time audio capture (simulated on Netlify)
- ✅ Responsive design
- ✅ Fast Gemini 2.5 Flash responses

### Troubleshooting

1. **CORS Issues**: Check that your domain is allowed in API settings
2. **Environment Variables**: Ensure all required variables are set
3. **Build Failures**: Check Node.js version compatibility
4. **WebSocket Issues**: Use alternative deployment platforms for full functionality

### Support

For issues with deployment, check:
- Netlify Function logs
- Browser console for errors
- API key validity
- Network connectivity
