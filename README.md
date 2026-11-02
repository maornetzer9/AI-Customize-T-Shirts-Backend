# 3D T-Shirt Customizer API

**A small Express API for the 3D T-Shirt Customizer.**

The API answers a health check and accepts the image-generation route used by the editor. Generation is intentionally unavailable. The customizer does not need this service for color, logo, or full-print editing.

[![API](https://img.shields.io/badge/API-Express%204-000000?style=flat-square)](https://ai-customize-t-shirts-backend.onrender.com/)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square)

**Health check:** [ai-customize-t-shirts-backend.onrender.com](https://ai-customize-t-shirts-backend.onrender.com/)

**Frontend:** [AI Customize T-Shirts Frontend](https://github.com/maornetzer9/AI-Customize-T-Shirts-Frontend)

## What It Does

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/` | `200` and `{"message":"Server is running"}` |
| `GET` | `/api/v1/dalle` | `200` and `{"message":"Hello From Dalle"}` |
| `POST` | `/api/v1/dalle` | Validates `prompt`, then returns `503` and `{"error":"image_generation_unavailable"}` |

A prompt must be a string of 1 to 1000 characters after trimming. Anything else returns `400` and `{"error":"invalid_prompt"}`. JSON bodies are limited to 100 KB. POST requests are limited to 30 per minute per IP.

Browser origins `http://localhost:5173` and `http://127.0.0.1:5173` are allowed. `ORIGIN` adds one more allowed browser origin. Requests with no browser `Origin` header are allowed.

The server does not call an image provider. `ENABLE_IMAGE_GENERATION` does not turn generation on.

## Tech Stack

Express 4, CORS, and dotenv. Tests use the Node.js built-in test runner. Nodemon restarts the process during local development.

## Project Structure

```text
├── routes
│   └── dalle.routes.js
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

```bash
npm run dev
npm test
```

The frontend development server posts to `http://localhost:8080/api/v1/dalle`. Its production build does not call this API.

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
