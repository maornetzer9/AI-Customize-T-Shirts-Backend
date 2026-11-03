import express from 'express'
import {
    IMAGE_REQUEST_TIMEOUT_MS,
    isImageGenerationConfigured,
    readImageGenerationConfig,
} from '../config/imageGeneration.js'
import { generateImage } from '../services/imageGeneration.js'

function readPrompt(body) {
    const prompt = body?.prompt
    if (typeof prompt !== 'string') return null

    const trimmed = prompt.trim()
    if (!trimmed || trimmed.length > 1000) return null

    return trimmed
}

function readMode(body) {
    if (body?.mode === undefined) return 'logo'
    if (body.mode === 'logo' || body.mode === 'full') return body.mode
    return null
}

const MAX_CONCURRENT_GENERATIONS = 2
const CONCURRENCY_RETRY_AFTER = '12'

export function createImageGenerationRouter({
    fetchImpl = fetch,
    config,
    timeoutMs = IMAGE_REQUEST_TIMEOUT_MS,
    maxConcurrent = MAX_CONCURRENT_GENERATIONS,
    maxImageBytes,
} = {}) {
    const router = express.Router()
    let activeGenerations = 0

    router.use((req, res, next) => {
        if (req.method === 'POST') {
            next()
            return
        }

        res.set('Allow', 'POST')
        res.status(405).json({ error: 'method_not_allowed' })
    })

    router.post('/', async (req, res) => {
        const prompt = readPrompt(req.body)
        if (!prompt) {
            res.status(400).json({ error: 'invalid_prompt' })
            return
        }

        const mode = readMode(req.body)
        if (!mode) {
            res.status(400).json({ error: 'invalid_mode' })
            return
        }

        const imageConfig = readImageGenerationConfig(config)
        if (!isImageGenerationConfigured(imageConfig)) {
            res.status(503).json({ error: 'image_generation_unavailable' })
            return
        }

        if (activeGenerations >= maxConcurrent) {
            res.set('Retry-After', CONCURRENCY_RETRY_AFTER)
            res.status(429).json({ error: 'rate_limit_exceeded' })
            return
        }

        activeGenerations += 1
        try {
            const result = await generateImage({
                prompt,
                mode,
                fetchImpl,
                config: imageConfig,
                timeoutMs,
                maxImageBytes,
            })

            if (result.image) {
                res.status(200).json({
                    image: result.image,
                    mediaType: result.mediaType,
                })
                return
            }

            const detail = result.providerCode ? ` ${result.providerCode}` : ''
            console.error(`Image generation failed at ${result.stage}${detail}`)
            res.status(result.status).json({ error: result.error })
        } catch {
            console.error('Image generation failed at network')
            res.status(503).json({ error: 'image_generation_unavailable' })
        } finally {
            activeGenerations -= 1
        }
    })

    return router
}
