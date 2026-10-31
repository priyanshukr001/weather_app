# Weatherly

A Delhi weather dashboard with a conversational Sky Guide.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and replace `add_your_key_here` with your OpenAI API key.
3. From this folder, run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000).

The app sends the current weather and five-day forecast to the Sky Guide so it can explain the conditions and expected changes. The API key stays on the server in `.env`; do not commit that file or put the key in browser code.

Deploy this as a Node.js web service with `npm start` as its start command, and set `OPENAI_API_KEY` as a server environment variable in the hosting provider. A static-only upload cannot run the chat API route.
