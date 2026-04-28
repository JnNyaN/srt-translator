require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const app = express();
// Payload ကြီးရင် လက်ခံနိုင်အောင် limit တိုးထားပါတယ်
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));

if (!process.env.API_KEY) {
  console.error('Missing API_KEY in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

/**
 * SRT format ကို JSON array ပြောင်းပေးတဲ့ function
 */
function srtToJSON(srtData) {
  const normalizedSrt = srtData.replace(/\r\n/g, '\n');
  const segments = normalizedSrt.trim().split(/\n\s*\n/);

  return segments
    .map((segment) => {
      const lines = segment.split('\n');
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

app.post('/translate', async (req, res) => {
  try {
    const { srtData } = req.body;
    if (!srtData) return res.status(400).json({ error: 'No data provided' });

    const allSegments = srtToJSON(srtData);
    // Render Free Tier သုံးနေရင် timeout မဖြစ်အောင် chunkSize ကို ၁၀-၁၅ လောက်ပဲ ထားဖို့ အကြံပြုပါတယ်
    const chunkSize = 15; 
    let translatedFull = [];

    // Output format ကို အမြဲတမ်း JSON ဖြစ်နေစေဖို့ Schema သတ်မှတ်ခြင်း
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
      model: 'gemini-2.5-flash', // သင်အဆင်ပြေတယ်ဆိုတဲ့ version ကို သုံးထားပါတယ်
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });

    console.log(`Translation started: Total segments ${allSegments.length}`);

    for (let i = 0; i < allSegments.length; i += chunkSize) {
      const chunk = allSegments.slice(i, i + chunkSize);

      const prompt = `
        Act as a Senior Full-stack Developer and Professional Educator.
        Translate the following programming tutorial subtitles from English into Myanmar.

        STRICT RULES:
        1. Tone: Friendly, conversational, and encouraging (Spoken Burmese/စကားပြောဟန်).
        2. Grammar: Use "တယ်/မယ်/ပါ" endings. Avoid literary endings like "သည်/၏/အံ့".
        3. Technical Terms: DO NOT translate terms like "function", "variable", "array", "object", "callback", "promise", "async/await", "component", "state", "props", "hook". Keep them in English.
        4. Transcreation: Make the explanation natural for a developer. If a direct translation sounds like a robot, rewrite it to be clear in Myanmar.
        5. Context: This is a programming tutorial.
        6. Structure: Keep "id" and "time" fields exactly as they are.

        Input JSON:
        ${JSON.stringify(chunk)}
      `.trim();

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        const translatedChunk = JSON.parse(responseText);
        translatedFull = translatedFull.concat(translatedChunk);
        
        console.log(`Progress: ${translatedFull.length} / ${allSegments.length}`);
      } catch (err) {
        console.error(`❌ Error at chunk index ${i}:`, err.message);
        
        // Error ဖြစ်ရင် UI မှာ သိသာအောင် error ပို့ပေးပါမယ်
        return res.status(500).json({ 
          success: false, 
          error: `AI Error at segment ${i}: ${err.message}` 
        });
      }
    }

    // JSON ကို SRT format ပြန်ပြောင်းခြင်း
    const finalSRT = translatedFull
      .map((obj) => `${obj.id}\n${obj.time}\n${obj.text}`)
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
  console.log(`Server running on http://localhost:${PORT}`);
});
