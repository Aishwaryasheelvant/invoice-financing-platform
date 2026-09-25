import { config } from 'dotenv';
import { resolve } from 'path';

// Deliberately a separate file from the dev .env: e2e tests point at their
// own database/redis so a test run can never touch dev or prod data.
config({ path: resolve(__dirname, '../.env.test') });
