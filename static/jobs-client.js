/** Short polling requests survive reverse-proxy timeouts; ids are safe to persist, secrets are not. */
import { authorizedFetch } from './auth.js';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function pollJob(id, onUpdate = () => {}) {
  while (true) {
    let response;
    try {
      response = await authorizedFetch('/api/jobs/' + encodeURIComponent(id));
    } catch {
      await delay(1500);
      continue;
    }
    if (!response.ok) throw Error('Job status unavailable');
    const job = await response.json();
    onUpdate(job);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state)) return job;
    await delay(750);
  }
}
