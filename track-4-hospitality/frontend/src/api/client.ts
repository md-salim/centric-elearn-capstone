export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = response.statusText
    try {
      const problem = await response.json() as { detail?: unknown; title?: unknown }
      if (typeof problem.detail === 'string') message = problem.detail
      else if (typeof problem.title === 'string') message = problem.title
    } catch {
      // The server response was not a ProblemDetails document.
    }
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const qs = query.toString()
  return requestJson<T>(qs ? `${path}?${qs}` : path)
}

export const postJson = <T>(path: string, body: unknown): Promise<T> =>
  requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const putJson = <T>(path: string, body: unknown): Promise<T> =>
  requestJson<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
