export const jsonCachePlugin = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.ok && /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      ? response : null,
}
