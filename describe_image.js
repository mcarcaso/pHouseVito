import fs from 'fs';
import fetch from 'node-fetch';

async function describeImage() {
  const imagePath = 'user/images/1771271423757_6502919c.jpg';
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const apiKey = process.env.GEMINI_API_KEY;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageData } },
          { text: 'Describe this image in detail. What is in it?' }
        ]
      }]
    })
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

describeImage();
