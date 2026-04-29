require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

if (!process.env.API_KEY) {
  console.error('Missing API_KEY in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// SRT -> JSON
function srtToJSON(srtData) {
  const segments = srtData.trim().split(/\r?\n\s*\r?\n/);

  return segments
    .map((segment) => {
      const lines = segment.split(/\r?\n/);

      if (lines.length >= 3) {
        return {
          id: lines[0].trim(),
          time: lines[1].trim(),
          text: lines.slice(2).join(' ').trim(),
        };
      }

      return null;
    })
    .filter(Boolean);
}

// Gemini response ထဲက code fence / extra text တွေဖယ်ပြီး JSON parse လုပ်ရန်
function safeParseJSON(text) {
  const cleaned = text
    .replace(/^
    .replace(/^
\s*/i, '')
    .replace(/\s*$/i, '')
    .trim();

  return JSON.parse(cleaned);
}

app.post('/translate', async (req, res) => {
  try {
    const { srtData } = req.body;

    if (!srtData) {
      return res.status(400).json({ error: 'No data provided' });
    }

    const allSegments = srtToJSON(srtData);
    const chunkSize = 20;
    let translatedFull = [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    console.log(Starting translation: Total segments ${allSegments.length});

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);

      const prompt = 
Translate this YouTube subtitle content into Myanmar language like a human,.

Rules:
- Keep the numbering (id) and timestamps (time) exactly the same.
- Translate only the "text" field.
- Do NOT translate technical programming terms like "function", "loop", "variable", "object", "array", "callback", "promise", "async/await", etc.
- Keep those technical terms in English.
- Make the explanation natural and easy to understand for a programming student.

Return ONLY a JSON array in this exact format:
[
  {"id":"1","time":"00:00:01,000 --> 00:00:02,000","text":"..."}
]

Content:
${JSON.stringify(chunk)}
      .trim();

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        const translatedChunk = safeParseJSON(responseText);

        if (!Array.isArray(translatedChunk)) {
          throw new Error('AI response is not a JSON array');
        }

        translatedFull = translatedFull.concat(translatedChunk);
        console.log(Progress: ${translatedFull.length} / ${allSegments.length});
      } catch (err) {
        console.error(Error at chunk ${i}:, err.message);

        // Fallback: translation 
        translatedFull = translatedFull.concat(chunk);
      }
    }

    const finalSRT = translatedFull
      .map((obj) => ${obj.id}\n${obj.time}\n${obj.text})
      .join('\n\n');

    res.json({
      success: true,
      srt: finalSRT,
    });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(Server running on http://localhost:${PORT}`);
});
