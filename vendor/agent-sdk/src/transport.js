export function endpoint(baseUrl, allowInsecureHttp = false) {
  const url = new URL(baseUrl);
  if (!(url.protocol === 'https:' || (allowInsecureHttp && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash)
    throw new TypeError('Use an HTTPS base URL without credentials, query or fragment. HTTP requires allowInsecureHttp for development.');
  return url.href.replace(/\/$/, '');
}

export function boundedFetch(fetchImpl, timeoutMs = 10000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive.');
  return (url, options = {}) => fetchImpl(url, {...options, redirect: 'error',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)});
}
