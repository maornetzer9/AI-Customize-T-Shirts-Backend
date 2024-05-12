import express from 'express';
import * as dotenv from 'dotenv'
import cors from 'cors'
import colors from 'colors'
import dalleRoutes from './routes/dalle.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT;
const ORIGIN = process.env.ORIGIN;
const corsOptions = {origin: ORIGIN, optionsSuccessStatus: 200}

const timeZone = new Date().toLocaleString({timeZone: 'Asia/Jerusalem'});

app.use(cors())
app.use(express.json({limit: '50mb'}))
app.use('/api/v1/dalle' , dalleRoutes)

app.get('/', async (req, res) => {
    try
    {
        return res.status(200).json({message: 'Server is running'})
    }
    catch(err)
    {
        console.error(err);
        return res.status(500).json('Internal server error...')
    }
})

app.listen(PORT, () => console.info(`Server is running on PORT: ${PORT}`.blue.bold, timeZone .magenta.bold))