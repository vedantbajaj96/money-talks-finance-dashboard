// Authenticated fetch wrapper.
// Automatically redirects to /login on 401 or session-expired redirects.
// Use this for every /api/* call — never use raw fetch() in components.

export async function apiFetch(url: string, options?: RequestInit): Promise<Response | null> {
  const res = await fetch(url, options);

  if (res.status === 401) {
    window.location.href = '/login';
    return null;
  }

  // Server sends 307 → browser follows → HTML login page with 200
  if (res.redirected && res.url.includes('/login')) {
    window.location.href = '/login';
    return null;
  }

  return res;
}
