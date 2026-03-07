prompt = """
Core Constraint: This is an image-to-image prompt. Precisely adhere to the geometric volume, proportions, and pose of the provided blocked-out character input. Do not warp the underlying silhouette.
Subject Detail: An ultra-detailed digital concept art full-body render of a [Character Class, e.g., Sci-fi Mercenary / Female Paladin / Anthropomorphic Fox Rogue].
Costume & Texture: The character is wearing [Describe Clothing/Armor here in detail, e.g., segmented plating, weathered leather straps, glowing neon trim, and heavy woven canvas fatigues]. Add high-fidelity micro-textures to all surfaces [e.g., specific fabrics, scratched metal, wood grain, or skin pores].
Facial Features/Accessory: Detail the face as [e.g., aged, stern, wearing a mechanical mask, or having large glowing eyes]. Add accessories like [e.g., pouches, a holstered weapon, or a back-mounted generator].
LIGHTING CRUCIAL: The lighting must be perfect, flat, neutral, studio-diffuse lighting. There must be NO heavy shadows, NO harsh directional light, NO dramatic rim lighting, and NO baked ambient occlusion. The light should be bright, even, and reveal all textures clearly from every angle.
Background: The character is isolated on a perfectly flat, uniform, neutral light gray color background (no floor texture, no environment) to ensure easy isolation for 3D conversion.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # load .env into os.environ so the client can find GEMINI_API_KEY

from google import genai
from google.genai import types

client = genai.Client()

# Must use a model with free-tier image quota; gemini-3.1-flash-image has limit 0
chat = client.chats.create(
    model="gemini-3.1-flash-image-preview",
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        tools=[{"google_search": {}}],
    ),
)

message = "Create a vibrant infographic that explains photosynthesis as if it were a recipe for a plant's favorite food. Show the \"ingredients\" (sunlight, water, CO2) and the \"finished dish\" (sugar/energy). The style should be like a page from a colorful kids' cookbook, suitable for a 4th grader."

response = chat.send_message(message)

for part in response.parts:
    if part.text is not None:
        print(part.text)
    elif (image := part.as_image()):
        Path("images").mkdir(parents=True, exist_ok=True)
        image.save("images/photosynthesis.png")
