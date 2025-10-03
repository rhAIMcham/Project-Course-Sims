import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/api/evaluate', async (req, res) => {
  try {
    console.log('Attempting API call to Anthropic...');
        
    // Extract the user message from the request body
    const userMessage = req.body.messages[0].content;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01' 
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: "You are an expert project management analyst specializing in Critical Path Method (CPM) analysis. Provide detailed, actionable insights with clear explanations. Format your response using markdown with clear headings and bullet points.",
        messages: [{
          role: 'user',
          content: userMessage
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Anthropic API Error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`API responded with status ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    console.log('API call successful');
    
    // Extract the text content from Claude's response
    const responseText = data.content[0].text;
    
    // Send back in the format your frontend expects
    res.json({ 
      content: responseText 
    });
    
  } catch (error) {
    console.error('Detailed error:', error);
    res.status(500).json({ 
      error: 'Failed to get AI evaluation',
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('API Key loaded:', !!process.env.ANTHROPIC_API_KEY);
});