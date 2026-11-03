import { IMAGE_MODEL } from '../config/imageGeneration.js'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
export const MAX_IMAGE_BYTES = 4_000_000

export async function generateImage({
    prompt,
    mode,
    fetchImpl,
    config,
    timeoutMs,
    maxImageBytes = MAX_IMAGE_BYTES,
}) {
    const generation = await requestModel({
        fetchImpl,
        config,
        prompt: mode === 'full' ? prompt : buildLogoPrompt(prompt),
        timeoutMs,
        retry: true,
        maxImageBytes,
    })

    if (!generation.ok) {
        return {
            status: 502,
            error: 'image_generation_failed',
            stage: 'provider',
            providerCode: generation.providerCode,
        }
    }

    if (!hasSignature(generation.bytes, JPEG_SIGNATURE) || generation.bytes.length > maxImageBytes) {
        return { status: 502, error: 'image_generation_failed', stage: 'output' }
    }

    if (mode === 'full') {
        return {
            status: 200,
            image: generation.image,
            mediaType: 'image/jpeg',
        }
    }

    const removed = await fetchImpl(config.workerUrl, {
        method: 'POST',
        headers: workerHeaders(config.workerToken),
        body: generation.bytes,
        signal: AbortSignal.timeout(timeoutMs),
    })

    if (!removed.ok) {
        await removed.arrayBuffer().catch(() => {})
        return { status: 502, error: 'image_generation_failed', stage: 'removal' }
    }

    const png = Buffer.from(await removed.arrayBuffer())
    if (!isPng(png) || png.length > maxImageBytes) {
        return { status: 502, error: 'image_generation_failed', stage: 'output' }
    }

    return {
        status: 200,
        image: png.toString('base64'),
        mediaType: 'image/png',
    }
}

async function requestModel({ fetchImpl, config, prompt, timeoutMs, retry, maxImageBytes }) {
    const first = await callModel(fetchImpl, config, prompt, timeoutMs, maxImageBytes)
    if (first.ok || !retry || first.status === 401 || first.status === 403) return first
    return callModel(fetchImpl, config, prompt, timeoutMs, maxImageBytes)
}

async function callModel(fetchImpl, config, prompt, timeoutMs, maxImageBytes) {
    const response = await fetchImpl(modelUrl(config.accountId), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(timeoutMs),
    })
    const payload = await response.json().catch(() => null)
    const image = readEncodedImage(payload)
    if (image.length > Math.ceil(maxImageBytes * 4 / 3) + 4) {
        return { ok: false, status: response.status, providerCode: null }
    }

    if (!response.ok || !image) {
        return {
            ok: false,
            status: response.status,
            providerCode: readProviderCode(payload),
        }
    }

    const bytes = Buffer.from(image, 'base64')
    if (!bytes.length) return { ok: false, status: response.status, providerCode: null }

    return { ok: true, image, bytes }
}

function modelUrl(accountId) {
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${IMAGE_MODEL}`
}

function buildLogoPrompt(prompt) {
    const instruction = 'A single centered subject on a plain solid background.'
    const combined = `${prompt}. ${instruction}`
    return combined.length <= 2048 ? combined : prompt
}

function readEncodedImage(payload) {
    const value = payload?.result?.image ?? payload?.image
    if (typeof value !== 'string') return ''

    const marker = 'base64,'
    const markerIndex = value.indexOf(marker)
    return (markerIndex === -1 ? value : value.slice(markerIndex + marker.length)).trim()
}

function readProviderCode(payload) {
    const code = payload?.errors?.[0]?.code
    return typeof code === 'number' ? code : null
}

function workerHeaders(workerToken) {
    const headers = { 'Content-Type': 'image/jpeg' }
    if (workerToken) headers['X-Worker-Token'] = workerToken
    return headers
}

function isPng(bytes) {
    return hasSignature(bytes, PNG_SIGNATURE)
}

function hasSignature(bytes, signature) {
    return signature.every((value, index) => bytes[index] === value)
}
