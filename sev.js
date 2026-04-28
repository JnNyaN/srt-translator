require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

function srtToJSON(srtData) {
  const segments = srtData.trim().split(/\r?\n\s*\r?\n/);
  return segments
    .map(segment => {
      const lines = segment.split(/\r?\n/);
      if (lines.length >= 3) {
        return {
          id: lines[0].trim(),
          time: lines[1].trim(),
          text: lines.slice(2).join(' ')
        };
      }
      return null;
    })
    .filter(Boolean);
}

app.post('/translate', async (req, res) => {
  try {
    const { srtData } = req.body;
    if (!srtData) return res.status(400).json({ error: 'No data provided' });

    const allSegments = srtToJSON(srtData);
    const chunkSize = 20;
    let translatedFull = [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });

    console.log(`Starting translation: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);

      const prompt = `
Translate the 'text' field of these subtitle objects into Myanmar (Burmese) accurately.
Return ONLY a JSON array.
Keep 'id' and 'time' exactly the same.

Input:
${JSON.stringify(chunk)}
      `.trim();

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const translatedChunk = JSON.parse(responseText);
        translatedFull = translatedFull.concat(translatedChunk);

        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);
      } catch (err) {
        console.error(`Error at chunk ${i}:`, err.message);
        translatedFull = translatedFull.concat(chunk);
      }
    }

    const finalSRT = translatedFull
      .map(obj => `${obj.id}\n${obj.time}\n${obj.text}`)
      .join('\n\n');

    res.json({ success: true, srt: finalSRT });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
