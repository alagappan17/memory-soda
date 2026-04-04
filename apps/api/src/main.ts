import express from 'express';
import cors from 'cors';
import helloRouter from './routes/hello.js';
import healthRouter from './routes/health.js';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3004;

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/hello', helloRouter);

app.listen(port, host, () => {
  console.log(`[ ready ] http://${host}:${port}`);
});
