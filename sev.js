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
  req.setTimeout(0); 

  try {
    const { srtData } = req.body;
    if (!srtData) return res.status(400).json({ success: false, error: 'No data provided' });

    const allSegments = srtToJSON(srtData);
    const chunkSize = 40; 
    let translatedFull = [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      // System Instruction ကို ပိုပြီး တိုတိုနဲ့ ရှင်းရှင်း ပြောင်းလိုက်ပါတယ်
      systemInstruction: "You are a professional Burmese translator. Translate English subtitles into natural, conversational Burmese. Keep technical terms like JavaScript, syntax, function in English. Return ONLY the translated JSON array.",
      generationConfig: { 
        responseMimeType: 'application/json'
      }
    });

    console.log(`Starting: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);
      
      // Prompt ကို ပိုပြီး Direct ဖြစ်အောင် ပြင်ထားပါတယ်
      const prompt = `Translate the 'text' values in this JSON array to Burmese: ${JSON.stringify(chunk)}`;

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON မဟုတ်တဲ့ စာသားတွေ ပါလာရင် ဖယ်ရှားဖို့
        const startIdx = responseText.indexOf('[');
        const endIdx = responseText.lastIndexOf(']') + 1;
        const cleanedResponse = responseText.substring(startIdx, endIdx);
        
        const translatedChunk = JSON.parse(cleanedResponse);
        translatedFull = translatedFull.concat(translatedChunk);
        
        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);

        if (i + chunkSize < allSegments.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.error(`Chunk ${i} error, skipping translation for this chunk.`);
        // ဘာသာမပြန်နိုင်ရင် မူရင်းကိုပဲ ထည့်မယ် (ဒါကြောင့် English ပြန်ထွက်လာတာပါ)
        translatedFull = translatedFull.concat(chunk);
      }
    }

    const finalSRT = translatedFull
      .map(obj => `${obj.id}\n${obj.time}\n${obj.text}`)
      .join('\n\n');

    return res.json({ success: true, srt: finalSRT });

  } catch (error) {
    console.error('Final Server Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
