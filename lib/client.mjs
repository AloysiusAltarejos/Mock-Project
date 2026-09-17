/** Local-only client for instrumenting an external chat host. No UI polling needed. */
export class TimerClient {
  constructor({ token, baseURL = 'http://127.0.0.1:4317' }) {
    if (!token) throw new Error('A TIMER_API_TOKEN is required.');
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('The timer client only connects to a local server.');
    this.baseURL = url.origin;
    this.token = token;
  }
  async event(action, properties = {}) {
    const response = await fetch(`${this.baseURL}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Timer-Token': this.token },
      body: JSON.stringify({ ...properties, action }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Timer returned ${response.status}.`);
    return payload.result;
  }
}
