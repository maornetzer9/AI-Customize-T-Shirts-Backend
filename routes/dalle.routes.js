import express from 'express'

const MAX_PROMPT_LENGTH = 1000

function readPrompt(body) {
    const prompt = body?.prompt
    if (typeof prompt !== 'string') return null

    const trimmed = prompt.trim()
    if (trimmed.length < 1 || trimmed.length > MAX_PROMPT_LENGTH) return null

    return trimmed
}

export function createDalleRouter() {
    const router = express.Router()

    router.route('/').get((req, res) => {
        res.status(200).json({ message: 'Hello From Dalle' })
    })

    router.route('/').post((req, res) => {
        const prompt = readPrompt(req.body)
        if (!prompt) {
            return res.status(400).json({ error: 'invalid_prompt' })
        }

        return res.status(503).json({ error: 'image_generation_unavailable' })
    })

    return router
}

export default createDalleRouter
