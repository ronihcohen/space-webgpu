import { readFile } from 'node:fs/promises';
import { createClient } from '@vercel/postgres';

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const client = createClient();

await client.connect();
try {
  await client.query(schema);
  console.log('Schema applied.');
} finally {
  await client.end();
}
