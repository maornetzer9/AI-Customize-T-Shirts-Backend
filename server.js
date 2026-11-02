import express from 'express'
import * as dotenv from 'dotenv'
import cors from 'cors'
import path from 'path'
import { pathToFileURL } from 'url'
import { createDalleRouter } from './routes/dalle.routes.js'

dotenv.config()

const RATE_WINDOW_MS = 60_000
const RATE_MAX_POSTS = 30
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

function allowedOrigins() {
    return [...new Set([process.env.ORIGIN, ...DEV_ORIGINS].filter(Boolean))]
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

export function createApp({ rateLimit } = {}) {
    const app = express()

    app.use(cors(createCorsOptions()))
    app.use(express.json({ limit: '100kb' }))
    app.use(createRateLimiter(rateLimit))
    app.use('/api/v1/dalle', createDalleRouter())

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
