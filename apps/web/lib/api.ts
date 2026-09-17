import ky, { HTTPError } from "ky";

/**
 * Every call goes through the same-origin /api proxy to the orchestrator, so
 * the session cookie is first-party and no CORS negotiation is needed.
 * The surface holds no state and decides no permissions - it asks and renders.
 */
export const api = ky.create({
  prefixUrl: typeof window === "undefined" ? undefined : "/api",
  credentials: "include",
  timeout: 30000,
  retry: 0,
});

export interface ApiError {
  status: number;
  message: string;
  missingKeys?: string[];
}

/**
 * The orchestrator's refusals are written to be shown verbatim - they name the
 * missing certification, the empty slot, or who is allowed to act. Replacing
 * them with a generic "something went wrong" throws away the useful half.
 */
export async function toApiError(err: unknown): Promise<ApiError> {
  if (err instanceof HTTPError) {
    try {
      const body: any = await err.response.clone().json();
      const message = typeof body?.message === "string" ? body.message : body?.message?.message;
      return {
        status: err.response.status,
        message: message ?? "That did not work.",
        missingKeys: body?.message?.missingKeys ?? body?.missingKeys,
      };
    } catch {
      return { status: err.response.status, message: err.message };
    }
  }
  return { status: 0, message: (err as Error)?.message ?? "Network error" };
}

export async function get<T>(path: string): Promise<T> {
  return api.get(path).json<T>();
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return api.post(path, body === undefined ? undefined : { json: body }).json<T>();
}

export async function del<T>(path: string): Promise<T> {
  return api.delete(path).json<T>();
}
