require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

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
    const chunkSize = 30; // ပိုစိတ်ချရအောင် ၃၀ ပဲ ထားပါမယ်
    let translatedFull = [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      // Safety Settings ကြောင့် Block ဖြစ်တာကို ကာကွယ်ဖို့
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: { 
        responseMimeType: 'application/json'
      }
    });

    console.log(`Starting translation: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);
      
      // AI နားလည်လွယ်ဆုံး ဖြစ်အောင် Prompt ကို မွမ်းမံထားပါတယ်
      const prompt = `You are a translator. Translate the 'text' field of each object in this JSON array into conversational Burmese. 
      Keep technical terms like JavaScript, CSS, HTML, syntax, function, loop in English. 
      Return only the valid JSON array of objects with the translated text.
      
      Input: ${JSON.stringify(chunk)}`;

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON သန့်သန့်လေး ရအောင်လုပ်မယ်
        const startIdx = responseText.indexOf('[');
        const endIdx = responseText.lastIndexOf(']') + 1;
        const cleanedResponse = responseText.substring(startIdx, endIdx);
        
        if (!cleanedResponse) throw new Error("Empty AI Response");

        const translatedChunk = JSON.parse(cleanedResponse);
        translatedFull = translatedFull.concat(translatedChunk);
        
        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);

        // Rate limit မမိအောင် ၃ စက္ကန့် စောင့်မယ်
        if (i + chunkSize < allSegments.length) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (err) {
        console.error(`Chunk ${i} Error:`, err.message);
        // Error တက်ရင် မူရင်း English ကိုပဲ ထည့်ပြီး ဆက်သွားမယ်
        translatedFull = translatedFull.concat(chunk);
        await new Promise(resolve => setTimeout(resolve, 5000));
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
