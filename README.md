# WEARFORM API

**The image API for WEARFORM, an AI-powered 3D apparel studio.**

[API](https://ai-customize-t-shirts-backend.onrender.com/) · [Studio](https://wearform-studio.onrender.com/)

## Product overview

The API serves a health check and one generation route. WEARFORM uses it for AI Logo and AI Full. Color, image upload, and the sample mark on the shirt do not need this service.

Generation runs only when the Cloudflare settings are present. The browser never receives the Cloudflare token, the worker token, or a provider error body.

## Architecture

Express 4 checks the prompt and mode, then calls Cloudflare Workers AI. Logo mode sends the JPEG to the background-removal Worker and returns a PNG. Full mode returns the JPEG unchanged. CORS, a per-IP post limit, a concurrency cap, and security headers sit in front of the route.

```text
browser → POST /api/v1/images/generate
        → FLUX.1 Schnell on Cloudflare Workers AI
        → logo: background-removal Worker → image/png
        → full: image/jpeg
```

```text
cloudflare/background-removal.js   Worker source for logo background removal
config/imageGeneration.js          Model name, timeout, and setting checks
routes/imageGeneration.routes.js   Validation, concurrency, and responses
services/imageGeneration.js        Model call, retry, and worker call
server.js                          CORS, rate limit, headers, and startup
```

The Worker source is in this repository. The running Worker is a separate Cloudflare deployment and is not started by `npm start`.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/` | `200` and `{"message":"Server is running"}` |
| `POST` | `/api/v1/images/generate` | A generated image, or one of the errors below |

### Generate

```http
POST /api/v1/images/generate
Content-Type: application/json

{ "prompt": "a small red star", "mode": "logo" }
```

`mode` may be omitted and then defaults to `logo`. `full` keeps the generated artwork.

```json
{ "image": "<base64>", "mediaType": "image/png" }
```

AI Full uses `"mediaType": "image/jpeg"`.

A logo prompt is sent to the model with one added instruction: a single centered subject on a plain background, when the combined text still fits. That instruction is not returned to the browser.

## Cloudflare Workers AI

The route calls `@cf/black-forest-labs/flux-1-schnell` when `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_BACKGROUND_WORKER_URL` are set. The account id must be 32 hex characters. The worker address must be HTTPS. The API token is sent only to Cloudflare.

A provider failure is retried once, except for `401` and `403`. The browser receives `502` and `image_generation_failed`. A timeout, or a missing configuration, returns `503` and `image_generation_unavailable`. Each outbound call is limited to 12 seconds. A returned image must be a real JPEG or PNG and at most 4 MB.

## Background removal

Logo mode posts the JPEG to `CLOUDFLARE_BACKGROUND_WORKER_URL`. When `CLOUDFLARE_BACKGROUND_WORKER_TOKEN` is set, it is sent only on that request as `X-Worker-Token`. The Worker rejects a request without the expected token, a body that is not a JPEG, and an image over 4 MB.

Full mode does not call the Worker. A Worker rejection, or a response that is not a PNG, becomes `502`.

## Validation, rate limiting, and concurrency

The prompt must be a string of 1 to 1,000 characters after trimming. `mode` must be `logo`, `full`, or omitted. JSON bodies over 100 KB are rejected.

Posts are limited to 8 per 10 minutes per IP. The limiter stores hits in memory. A private-network proxy may set the client IP. A caller cannot choose that IP with a forwarding header.

Two generations may run at the same time. A third receives `429`, `rate_limit_exceeded`, and `Retry-After: 12`.

## Errors

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"invalid_prompt"}` | The prompt is missing, blank, or longer than 1,000 characters after trimming |
| `400` | `{"error":"invalid_mode"}` | `mode` is not `logo` or `full` |
| `405` | `{"error":"method_not_allowed"}` | The generation path receives a method other than POST |
| `413` | `{"error":"payload_too_large"}` | JSON is larger than 100 KB |
| `429` | `{"error":"rate_limit_exceeded"}` | The IP limit or the concurrency cap is full |
| `502` | `{"error":"image_generation_failed"}` | The model or the Worker fails, or the image is unusable |
| `503` | `{"error":"image_generation_unavailable"}` | Configuration is missing or the call times out |
| `500` | `{"error":"internal_error"}` | An unexpected server error |

Responses also send `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and `Cache-Control: no-store`.

Browser origins `http://localhost:5173` and `http://127.0.0.1:5173` are allowed. The published studio and the previous studio origin are allowed as well. `ORIGIN` may add more origins, separated by commas. Requests with no `Origin` header are allowed. Retired generation URLs are not served.

## Verification

```bash
npm test
```

The 20 tests cover the health check, validation, CORS, body size, the IP limit, a spoofed forwarding header, concurrency, security headers, logo PNG output, full-print JPEG output, one provider retry, timeouts, and generic provider errors. The tests do not call Cloudflare.

## Local development

Requirements: Node.js 18 or newer, and npm.

```bash
npm install
```

Copy `.env.example` to `.env`. The process reads these names:

| Name | Purpose |
| --- | --- |
| `PORT` | Port the API listens on. Use `8080` locally. The host sets this in production. |
| `ORIGIN` | Extra browser origins allowed by CORS, separated by commas. Local Vite origins and the published studio origins are already allowed. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account used by Workers AI. |
| `CLOUDFLARE_API_TOKEN` | Token used only by the API to run Workers AI. |
| `CLOUDFLARE_BACKGROUND_WORKER_URL` | HTTPS address of the background-removal Worker. |
| `CLOUDFLARE_BACKGROUND_WORKER_TOKEN` | Shared token sent to the Worker as `X-Worker-Token`. |

Do not commit `.env`. The example file contains placeholders only.

```bash
npm run dev
npm test
```

| Script | Purpose |
| --- | --- |
| `npm start` | Run the API with Node |
| `npm run dev` | Run the API locally with nodemon |
| `npm test` | Run the API tests |

The studio’s development server posts to `http://localhost:8080/api/v1/images/generate`. Its production build posts to this API on the same path.

## Deployment

| Setting | Value |
| --- | --- |
| Install | `npm install` |
| Start | `npm start` |

`npm start` runs `node server.js`. The live API is [ai-customize-t-shirts-backend.onrender.com](https://ai-customize-t-shirts-backend.onrender.com/). The Render service is named `wearform-api` and stayed on the free plan. Renaming the service kept this public address, so `wearform-api.onrender.com` is not the API. A push to `main` deploys automatically. The host supplies `PORT` and the Cloudflare settings. The studio stays available when this API does not.

## Related repositories

| | Repository |
| --- | --- |
| This API | [wearform-backend](https://github.com/maornetzer9/wearform-backend) |
| WEARFORM studio | [wearform-frontend](https://github.com/maornetzer9/wearform-frontend) |

## License

ISC. See `package.json`.
