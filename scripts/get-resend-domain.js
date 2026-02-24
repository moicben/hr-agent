import 'dotenv/config';
import { getVerifiedSendingDomains } from '../utils/resend.js';

try {
  const domains = await getVerifiedSendingDomains();
  console.log(domains);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}