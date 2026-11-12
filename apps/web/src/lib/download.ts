import { apiFetch } from './api';

/**
 * Saves a file the API gives (with the person's token) under a name, never opening it: the bytes
 * are kept as a plain download whatever they hold, so a file a sender chose (an HTML page, an
 * SVG) never runs in the app's own pages (F-114 step 4b).
 */
export async function saveDownload(path: string, token: string, name: string): Promise<void> {
  const response = await apiFetch(path, token);
  const bytes = await response.arrayBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // After the click has handed the file to the browser.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
  }
}
