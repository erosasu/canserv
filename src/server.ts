import dotenv from 'dotenv';

import config from './config';
import { initServer } from './index';

dotenv.config();

initServer(config);
