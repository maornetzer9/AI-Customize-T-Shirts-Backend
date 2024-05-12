import express from 'express'
import * as dotenv from 'dotenv'
// import { Configuration, OpenAIApi } from 'openai';
import OpenAI from 'openai/index.mjs';


dotenv.config();

const router = express.Router();
const config = { apiKey: process.env.OPENAI_API_KEY }
const openai = new OpenAI(config);


router.route('/').get((req, res) => {
    res.status(200).json({message: 'Hello From Dalle'})
})

router.route('/').post(async (req, res) => {
    try
    {
        const { prompt } = req.body;
        const response = await openai.images.generate({prompt, model: "dall-e-3", n: 1, size: '1024x1024', response_format: 'b64_json'});
        const { b64_json } = response.data[0]

        return res.status(200).json({ image: b64_json })
    }
    catch(err)
    {
        console.error(err);
        return res.status(500).json('Internal server error')
    }
})

export default router 