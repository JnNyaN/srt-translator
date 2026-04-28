require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// ခဏ စောင့်ခိုင်းဖို့ function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function srtToJSON(srtData) {
  const normalizedSrt = srtData.replace(/\r\n/g, '\n');
  const segments = normalizedSrt.trim().split(/\n\s*\n/);
  return segments.map((segment) => {
    const lines = segment.split('\n');
    if (lines.length >= 3) {
      return { id: lines[0].trim(), time: lines[1].trim(), text: lines.slice(2).join(' ').trim() };
    }
    return null;
  }).filter(Boolean);
}

app.post('/translate', async (req, res) => {
  try {
    const { srtData } = req.body;
    if (!srtData) return res.status(400).json({ error: 'No data provided' });

    const allSegments = srtToJSON(srtData);
    const chunkSize = 40; // တစ်ခါပို့ရင် စာကြောင်း ၄၀ ပို့မယ် (Request အကြိမ်ရေ လျော့သွားအောင်)
    let translatedFull = [];

    const schema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          time: { type: SchemaType.STRING },
          text: { type: SchemaType.STRING },
        },
        required: ["id", "time", "text"],
      },
    };

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash', // ၂.၅ အဆင်မပြေရင် ၁.၅ ပြန်ပြောင်းကြည့်ပါ
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    });

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);
      
      // Request တစ်ခု မပို့ခင် ၃ စက္ကန့် စောင့်မယ် (API ကန့်သတ်ချက် မမိအောင်)
      if (i > 0) {
        console.log("Waiting 3 seconds for rate limit...");
        await sleep(3000);
      }

      const prompt = `
        Act as a Senior Full-stack Developer. Translate this programming tutorial JSON to Myanmar (Spoken Burmese).
        Keep technical terms in English. Use "တယ်/မယ်/ပါ". 
        Input: ${JSON.stringify(chunk)}
      `;

      try {
        const result = await model.generateContent(prompt);
        const translatedChunk = JSON.parse(result.response.text());
        translatedFull = translatedFull.concat(translatedChunk);
        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);
      } catch (err) {
        console.error(`Error at chunk ${i}:`, err.message);
        // Error တက်ရင် ၅ စက္ကန့်လောက် ထပ်စောင့်ပြီး တစ်ခါပဲ ထပ်ကြိုးစားကြည့်မယ် (Retry logic)
        await sleep(5000);
        try {
            const result = await model.generateContent(prompt);
            const translatedChunk = JSON.parse(result.response.text());
            translatedFull = translatedFull.concat(translatedChunk);
        } catch(retryErr) {
            translatedFull = translatedFull.concat(chunk); // ဒုတိယအကြိမ်ပါ မရရင် မူရင်းပဲ ထည့်လိုက်မယ်
        }
      }
    }

    const finalSRT = translatedFull.map((obj) => `${obj.id}\n${obj.time}\n${obj.text}`).join('\n\n');
    res.json({ success: true, srt: finalSRT });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(process.env.PORT || 3000);
