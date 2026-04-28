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

    // Model ကို gemini-2.5-flash ပြန်ပြောင်းပေးထားပါတယ်
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: "You are an expert Burmese Subtitle Translator for technical tutorials. Use natural conversational Burmese (ending with တယ်/မယ်/ပါ) and avoid formal language (သည်/သတည်း). Keep core technical terms like 'syntax', 'function', 'variable', 'array', 'loop' in English to help students.",
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });

    console.log(`Starting translation: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);

      const prompt = `
Translate the 'text' field of the following subtitle objects into natural, mentor-like Burmese. 
Ensure the meaning flows logically with the context.
Return ONLY a JSON array. 
Do NOT change the 'id' and 'time' fields.

Input Data:
${JSON.stringify(chunk)}
      `.trim();

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // Markdown backticks များကို ဖယ်ရှားရန်
        const cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const translatedChunk = JSON.parse(cleanedResponse);
        
        translatedFull = translatedFull.concat(translatedChunk);

        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);
      } catch (err) {
        console.error(`Error at chunk ${i}:`, err.message);
        // Error ဖြစ်ပါက မူရင်း text အတိုင်း ခဏသိမ်းထားမည်
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

