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
    
    // Chunk size ကို ၄၀ အထိ တိုးလိုက်ပါတယ် (Request အကြိမ်ရေ လျော့သွားအောင်)
    const chunkSize = 40; 
    let translatedFull = [];

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
        
        const cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const translatedChunk = JSON.parse(cleanedResponse);
        
        translatedFull = translatedFull.concat(translatedChunk);

        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);

        // Chunk တစ်ခုပြီးတိုင်း ၄ စက္ကန့် နားပါမယ် (Rate limit မမိအောင်လို့ပါ)
        if (i + chunkSize < allSegments.length) {
          console.log("Waiting 4 seconds to avoid Rate Limit...");
          await new Promise(resolve => setTimeout(resolve, 4000));
        }

      } catch (err) {
        console.error(`Error at chunk ${i}:`, err.message);
        // Error ဖြစ်ရင် ဇာတ်လမ်းမပြတ်အောင် မူရင်းစာသားကိုပဲ ခေတ္တအစားထိုးမယ်
        translatedFull = translatedFull.concat(chunk);
        
        // Error တက်ရင်လည်း ၅ စက္ကန့်လောက် ပိုနားပေးလိုက်မယ်
        await new Promise(resolve => setTimeout(resolve, 5000));
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
