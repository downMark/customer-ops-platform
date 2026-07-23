import { Context } from "koa";
import { matchRoutes, StaticRouter } from "react-router-dom";
import { HelmetProvider, FilledContext } from "react-helmet-async";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  DehydratedState,
} from "@tanstack/react-query";
import App from "index";
import routes from "routes";

export const prefetch = async (ctx: Context, queryClient: QueryClient) => {
  const prefetchRoutes = matchRoutes(routes, ctx.path);
  if (prefetchRoutes) {
    const promiseRoutes = prefetchRoutes
      .map(({ route, params }) => {
        if (route?.queryKey && route?.loadData) {
          return queryClient.fetchQuery({
            queryKey: route.queryKey,
            queryFn: () => route.loadData(params),
          });
        }
      })
      .filter((i) => i);

    const results = await Promise.allSettled(promiseRoutes);
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.error("SSR prefetch failed:", result.reason);
      }
    });
  } else {
    console.warn(`No SSR prefetch route matched "${ctx.path}".`);
  }
  const dehydratedState = dehydrate(queryClient);

  return { dehydratedState };
};

export const renderApp = (
  ctx: Context,
  queryClient: QueryClient,
  dehydratedState: DehydratedState
) => {
  const helmetContext = {} as FilledContext;

  const jsx = (
    <StaticRouter location={ctx.req.url}>
      <HelmetProvider context={helmetContext}>
        <QueryClientProvider client={queryClient}>
          <HydrationBoundary state={dehydratedState}>
            <App context={ctx} />
          </HydrationBoundary>
        </QueryClientProvider>
      </HelmetProvider>
    </StaticRouter>
  );

  return {
    jsx,
    helmetContext,
  };
};
