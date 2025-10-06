# Troubleshooting Guide - Live Transcribe AI

## Common Production Issues

### 1. CORS Errors

**Error**: `Access to fetch at 'https://your-site.netlify.app/.netlify/functions/transcribe' from origin 'https://your-site.netlify.app' has been blocked by CORS policy`

**Solution**:
1. Update your site URL in the deployment script:
   ```bash
   npm run deploy:prod https://your-actual-site.netlify.app
   ```
2. Check that the `allowedOrigins` array in `netlify/functions/transcribe.js` includes your site URL
3. Verify CORS headers in `netlify.toml`

### 2. HTTPS Required Errors

**Error**: `getUserMedia() requires HTTPS`

**Solution**:
- Netlify automatically provides HTTPS
- Ensure you're accessing your site via `https://` not `http://`
- Check that HTTPS redirect is working in `netlify.toml`

### 3. API Key Issues

**Error**: `API key not valid` or `Missing GEMINI_API_KEY`

**Solution**:
1. Set environment variables in Netlify dashboard:
   - Go to Site Settings > Environment Variables
   - Add `GEMINI_API_KEY` with your actual API key
   - Add `ASSEMBLYAI_API_KEY` if using real-time transcription

2. Verify API key format:
   - Gemini API keys should start with `AIza`
   - AssemblyAI API keys should be 32 characters long

### 4. Function Timeout Errors

**Error**: `Function execution timed out`

**Solution**:
- Check that `maxOutputTokens` is set to a reasonable value (1000 or less)
- Optimize the prompt length
- Consider using `gemini-2.5-flash-lite` for faster responses

### 5. Audio Processing Issues

**Error**: `Failed to load audio worklet` or microphone access denied

**Solution**:
- Ensure you're on HTTPS
- Check browser permissions for microphone access
- Verify `audio-processor.js` is accessible and has correct MIME type

## Debugging Steps

### 1. Check Function Logs
```bash
# View Netlify function logs
netlify functions:log transcribe
```

### 2. Test Function Locally
```bash
# Test the function locally
netlify dev
# Then visit http://localhost:8888
```

### 3. Verify Environment Variables
```bash
# Check if environment variables are set
netlify env:list
```

### 4. Test API Keys
```bash
# Test Gemini API key
curl -H "Content-Type: application/json" \
  -d '{"transcript":"test"}' \
  https://your-site.netlify.app/.netlify/functions/transcribe
```

## Browser Console Debugging

Add this to your browser console to debug CORS issues:

```javascript
// Check if the function is accessible
fetch('/.netlify/functions/transcribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transcript: 'test' })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

## Common Fixes

### Fix 1: Update Site URL
If you get CORS errors, update your site URL:
```bash
npm run deploy:prod https://your-actual-site-name.netlify.app
```

### Fix 2: Clear Browser Cache
- Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Clear site data in browser dev tools

### Fix 3: Check Netlify Build
- Go to Netlify dashboard > Deploys
- Check build logs for errors
- Redeploy if necessary

### Fix 4: Verify Function Deployment
- Check that functions are deployed: `https://your-site.netlify.app/.netlify/functions/transcribe`
- Should return a JSON response, not a 404

## Still Having Issues?

1. **Check the deployment logs** in Netlify dashboard
2. **Test locally first** with `netlify dev`
3. **Verify all environment variables** are set correctly
4. **Check browser console** for specific error messages
5. **Try a different browser** to rule out browser-specific issues

## Support

If you're still experiencing issues:
1. Check the browser console for detailed error messages
2. Look at Netlify function logs
3. Verify your API keys are valid
4. Ensure your site is accessed via HTTPS
