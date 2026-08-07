const DOWNLOAD_ATTEMPTS = 4;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type Fetcher = (url: string) => Promise<Response>;
type Waiter = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetries(
  url: string,
  fetcher: Fetcher = fetch,
  waiter: Waiter = wait,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(url);
      if (response.ok || !RETRYABLE_HTTP_STATUSES.has(response.status)) return response;
      lastError = new Error(`HTTP ${response.status}`);
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
    }

    if (attempt < DOWNLOAD_ATTEMPTS) {
      await waiter(500 * (2 ** (attempt - 1)));
    }
  }

  throw new Error(`Download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${url}`, { cause: lastError });
}
