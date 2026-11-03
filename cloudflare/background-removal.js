const MAX_IMAGE_BYTES = 4_000_000
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response('Send a POST request with an image', { status: 405 })
        }

        const provided = request.headers.get('X-Worker-Token') || ''
        const expected = env.WORKER_AUTH_TOKEN || ''
        if (!expected || !tokensMatch(provided, expected)) {
            return new Response('Unauthorized', { status: 401 })
        }

        const declaredLength = Number(request.headers.get('content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
            return new Response('Image is too large', { status: 413 })
        }

        const bytes = await readLimited(request.body, MAX_IMAGE_BYTES)
        if (!bytes) {
            return new Response('Image is too large', { status: 413 })
        }
        if (!hasJpegSignature(bytes)) {
            return new Response('Expected a JPEG image', { status: 400 })
        }

        try {
            const result = await env.IMAGES
                .input(bytes)
                .transform({ segment: 'foreground' })
                .output({ format: 'image/png' })
            return result.response()
        } catch {
            return new Response('Background removal failed', { status: 500 })
        }
    },
}

function tokensMatch(provided, expected) {
    const encoder = new TextEncoder()
    const left = encoder.encode(provided)
    const right = encoder.encode(expected)
    if (left.length !== right.length) return false

    let difference = 0
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index]
    }
    return difference === 0
}

function hasJpegSignature(bytes) {
    return JPEG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

async function readLimited(stream, maxBytes) {
    if (!stream) return new Uint8Array(0)

    const reader = stream.getReader()
    const chunks = []
    let total = 0

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
            await reader.cancel()
            return null
        }
        chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return bytes
}
