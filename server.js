import express from 'express'
import * as dotenv from 'dotenv'
import cors from 'cors'
import path from 'path'
import { pathToFileURL } from 'url'
import { createImageGenerationRouter } from './routes/imageGeneration.routes.js'

dotenv.config()

const RATE_WINDOW_MS = 10 * 60_000
const RATE_MAX_POSTS = 8
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
const STUDIO_ORIGINS = [
    'https://ai-customize-t-shirts-frontend.onrender.com',
    'https://wearform-studio.onrender.com',
]

function configuredOrigins() {
    return String(process.env.ORIGIN || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
}

function allowedOrigins() {
    return [...new Set([...configuredOrigins(), ...STUDIO_ORIGINS, ...DEV_ORIGINS])]
}

function createCorsOptions() {
    const allowed = new Set(allowedOrigins())

    return {
        origin(origin, callback) {
            if (!origin || allowed.has(origin)) {
                callback(null, true)
                return
            }
            callback(null, false)
        },
        optionsSuccessStatus: 200,
    }
}

function createRateLimiter({ windowMs = RATE_WINDOW_MS, max = RATE_MAX_POSTS } = {}) {
    const hits = new Map()

    return function rateLimitPosts(req, res, next) {
        if (req.method !== 'POST') {
            next()
            return
        }

        const now = Date.now()
        const key = req.ip || 'unknown'
        const recent = (hits.get(key) || []).filter((timestamp) => now - timestamp < windowMs)

        if (recent.length >= max) {
            const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000))
            res.set('Retry-After', String(retryAfter))
            res.status(429).json({ error: 'rate_limit_exceeded' })
            return
        }

        recent.push(now)
        hits.set(key, recent)
        next()
    }
}

function handleClientError(err, req, res, next) {
    if (res.headersSent) {
        next(err)
        return
    }

    const status = err.status || err.statusCode
    if (status === 413 || err.type === 'entity.too.large') {
        res.status(413).json({ error: 'payload_too_large' })
        return
    }

    if (status && status < 500) {
        res.status(status).json({ error: 'invalid_request' })
        return
    }

    console.error('Request failed')
    res.status(500).json({ error: 'internal_error' })
}

function trustPrivateProxy(address) {
    const normalized = address.toLowerCase()
    if (normalized.includes(':')) {
        return normalized.startsWith('fc') || normalized.startsWith('fd')
    }

    const parts = normalized.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false
    }

    if (parts[0] === 10) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}

function setSecurityHeaders(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Referrer-Policy', 'no-referrer')
    res.set('X-Frame-Options', 'DENY')
    res.set('Cache-Control', 'no-store')
    next()
}

export function createApp({ rateLimit, imageGeneration } = {}) {
    const app = express()

    app.set('trust proxy', trustPrivateProxy)
    app.use(setSecurityHeaders)
    app.use(cors(createCorsOptions()))
    app.use(express.json({ limit: '100kb' }))
    app.use(createRateLimiter(rateLimit))
    app.use('/api/v1/images/generate', createImageGenerationRouter(imageGeneration))

    app.get('/', (req, res) => {
        res.status(200).json({ message: 'Server is running' })
    })

    app.use(handleClientError)

    return app
}

function isDirectRun() {
    const entry = process.argv[1]
    if (!entry) return false
    return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

const app = createApp()

if (isDirectRun()) {
    const PORT = process.env.PORT
    const timeZone = new Date().toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })
    app.listen(PORT, () => console.info(`Server is running on PORT: ${PORT} ${timeZone}`))
}

export default app
