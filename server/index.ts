import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'src', 'gemini', '.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI, Modality, type Content, type Part } from '@google/genai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const IMAGES_DIR = path.join(process.cwd(), 'src', 'gemini', 'images');

function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

app.post('/api/enhance', async (req, res) => {
  try {
    const { image, prompt } = req.body as { image?: string; prompt?: string };
    if (!image || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Missing image (base64) or prompt' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });
      return;
    }

    let base64Data = image;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1] ?? base64Data;
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents: Content = {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64Data,
          },
        },
        { text: prompt },
      ] as Part[],
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    const imageData = response.data;
    if (!imageData) {
      res.status(502).json({
        error: 'No image in response',
        text: response.text,
      });
      return;
    }

    ensureImagesDir();
    const filename = `enhance-${Date.now()}.png`;
    const filepath = path.join(IMAGES_DIR, filename);
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filepath, buffer);

    res.json({
      image: `data:image/png;base64,${imageData}`,
      savedPath: filepath,
      filename,
    });
  } catch (err) {
    console.error('Enhance error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Enhance failed',
    });
  }
});

app.get('/api/enhance/images', async (_req, res) => {
  try {
    ensureImagesDir();
    const files = await fs.promises.readdir(IMAGES_DIR);
    const enhancePngs = files
      .filter((f) => f.startsWith('enhance-') && f.toLowerCase().endsWith('.png'))
      .sort((a, b) => {
        const aNum = Number(a.slice('enhance-'.length, -'.png'.length));
        const bNum = Number(b.slice('enhance-'.length, -'.png'.length));
        if (Number.isNaN(aNum) || Number.isNaN(bNum)) return 0;
        return bNum - aNum;
      });

    const images = enhancePngs.map((filename) => ({
      filename,
      url: `/api/enhance/images/${encodeURIComponent(filename)}`,
    }));

    res.json(images);
  } catch (err) {
    console.error('List enhance images error:', err);
    res.status(500).json({ error: 'Failed to list enhance images' });
  }
});

app.get('/api/enhance/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    if (!/^enhance-\d+\.png$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Serve enhance image error:', err);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Enhance server listening on http://localhost:${PORT}`);
});
