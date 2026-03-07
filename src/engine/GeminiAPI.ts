import { getLibraryText } from './animationLibrary';

const BASE = '/api/gemini';

export async function pickAnimation(
  userPrompt: string,
): Promise<{ actionId: number; name: string }> {
  const libraryText = getLibraryText();

  const systemPrompt = `You are an animation selector. Given a library of animation presets and a user's natural-language description, pick the single best matching animation.

ANIMATION LIBRARY (format: ID: Name [Category]):
${libraryText}

Respond with ONLY a raw JSON object (no markdown, no code fences):
{"action_id": <number>, "name": "<animation name>"}`;

  const res = await fetch(
    `${BASE}/models/gemini-2.5-flash:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const raw =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Could not parse Gemini response: ${raw}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    actionId: parsed.action_id,
    name: parsed.name,
  };
}
