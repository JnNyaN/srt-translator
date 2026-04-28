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
  // အချိန်အကြာကြီး စောင့်နိုင်အောင် timeout ကို တိုးထားပေးပါမယ်
  req.setTimeout(0); 

  try {
    const { srtData } = req.body;
    if (!srtData) return res.status(400).json({ success: false, error: 'No data provided' });

    const allSegments = srtToJSON(srtData);
    // Chunk size ကို ၅၀ အထိ ထပ်တိုးလိုက်ပါတယ် (Request အကြိမ်ရေ ပိုနည်းသွားအောင်)
    const chunkSize = 50; 
    let translatedFull = [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: "Professional Burmese Subtitle Translator. Use conversational 'တယ်/မယ်'. Keep technical terms (syntax, function) in English.",
      generationConfig: { responseMimeType: 'application/json' }
    });

    console.log(`Starting: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);
      const prompt = `Translate 'text' into natural Burmese. Return ONLY JSON array. Don't change 'id'/'time'.\n\nInput: ${JSON.stringify(chunk)}`;

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const translatedChunk = JSON.parse(cleanedResponse);
        translatedFull = translatedFull.concat(translatedChunk);
        
        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);

        // Delay ကို ၂ စက္ကန့်ပဲ ထားပါမယ် (Timeout မဖြစ်အောင်လို့ပါ)
        if (i + chunkSize < allSegments.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.error(`Chunk Error:`, err.message);
        translatedFull = translatedFull.concat(chunk);
      }
    }

    const finalSRT = translatedFull
      .map(obj => `${obj.id}\n${obj.time}\n${obj.text}`)
      .join('\n\n');

    return res.json({ success: true, srt: finalSRT });

  } catch (error) {
    console.error('Final Server Error:', error);
    // ဘယ်လိုပဲ error တက်တက် JSON ပဲ ပြန်အောင် လုပ်ထားပါတယ်
    return res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
