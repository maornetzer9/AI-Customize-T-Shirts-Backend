# 3D T-Shirt Customizer API

**A small Express API for the 3D T-Shirt Customizer.**

The API answers a health check and accepts the image-generation route used by the editor. Generation runs only when the Cloudflare variables are set. The customizer does not need this service for color, logo, or full-print editing.

[![API](https://img.shields.io/badge/API-Express%204-000000?style=flat-square)](https://ai-customize-t-shirts-backend.onrender.com/)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square)

**Health check:** [ai-customize-t-shirts-backend.onrender.com](https://ai-customize-t-shirts-backend.onrender.com/)

**Frontend:** [AI Customize T-Shirts Frontend](https://github.com/maornetzer9/AI-Customize-T-Shirts-Frontend)

## What It Does

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/` | `200` and `{"message":"Server is running"}` |
| `POST` | `/api/v1/images/generate` | Validates `prompt` and optional `mode`. Logo mode returns a transparent PNG. Full mode returns the generated JPEG. Missing configuration returns `503`. |

A prompt must be a string of 1 to 1000 characters after trimming. Anything else returns `400` and `{"error":"invalid_prompt"}`. JSON bodies are limited to 100 KB. Generation is limited to 8 requests per 10 minutes per IP and 2 requests at a time. A limited request returns `429`, `{"error":"rate_limit_exceeded"}`, and `Retry-After`.

Browser origins `http://localhost:5173` and `http://127.0.0.1:5173` are allowed. `ORIGIN` adds one more allowed browser origin. Requests with no browser `Origin` header are allowed. The client IP comes from a private-network proxy. A direct caller cannot choose that IP with a forwarding header.

When `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_BACKGROUND_WORKER_URL` are set, a valid prompt is sent to Cloudflare FLUX.1 Schnell. `mode` `logo` sends that JPEG to the background-removal Worker and returns a transparent PNG. `mode` `full` returns the generated JPEG unchanged. A provider failure is retried once, then returned as `502` and `{"error":"image_generation_failed"}`. Timeouts and missing configuration return `503`.

## Tech Stack

Express 4, CORS, and dotenv. Tests use the Node.js built-in test runner. Nodemon restarts the process during local development.

## Project Structure

```text
├── cloudflare
│   └── background-removal.js
├── config
│   └── imageGeneration.js
├── routes
│   └── imageGeneration.routes.js
├── services
│   └── imageGeneration.js
├── server.js
├── server.test.js
├── .env.example
└── package.json
```

## Available Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Run the API with Node for production |
| `npm run dev` | Run the API locally with nodemon |
| `npm test` | Run the API tests |

## Local Development

```bash
npm install
```

Copy `.env.example` to `.env` and set the values below. The names are the only configuration this process reads.

| Name | Purpose |
| --- | --- |
| `PORT` | Port the API listens on. Use `8080` locally. The host sets this in production. |
| `ORIGIN` | One extra browser origin allowed by CORS. Local Vite origins are already allowed. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account used by Workers AI. |
| `CLOUDFLARE_API_TOKEN` | Token used only by the API to run Workers AI. |
| `CLOUDFLARE_BACKGROUND_WORKER_URL` | HTTPS address of the existing background-removal Worker. |
| `CLOUDFLARE_BACKGROUND_WORKER_TOKEN` | Shared token sent to the Worker as `X-Worker-Token`. Logo removal requires it. |

```bash
npm run dev
npm test
```

The frontend development server posts to `http://localhost:8080/api/v1/images/generate`. Its production build posts to this API on the same path.

## Deployment

This repository is the API:

[github.com/maornetzer9/AI-Customize-T-Shirts-Backend](https://github.com/maornetzer9/AI-Customize-T-Shirts-Backend)

The published service is [ai-customize-t-shirts-backend.onrender.com](https://ai-customize-t-shirts-backend.onrender.com/). The frontend is a separate repository and stays available when this API does not.

| Setting | Value |
| --- | --- |
| Install | `npm install` |
| Start | `npm start` |

`npm start` runs `node server.js`. Local development uses `npm run dev`.

A push to `main` deploys automatically. The host runs `npm install` and starts the process with `node server.js`.

## License

The package metadata identifies this project as ISC.
