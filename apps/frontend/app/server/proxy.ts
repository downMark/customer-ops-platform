export const createUpstreamUrl = (
  upstreamBaseUrl: string,
  upstreamPath: string,
  search: string,
) => {
  const upstreamUrl = new URL(upstreamBaseUrl);
  const basePath = upstreamUrl.pathname.replace(/\/+$/, "");
  const requestPath = upstreamPath.startsWith("/")
    ? upstreamPath
    : `/${upstreamPath}`;

  upstreamUrl.pathname = `${basePath}${requestPath}` || "/";
  upstreamUrl.search = search;
  upstreamUrl.hash = "";

  return upstreamUrl;
};
