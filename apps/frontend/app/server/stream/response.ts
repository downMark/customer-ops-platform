import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import {
  getStartTemplate,
  getEndTemplate,
  StartTemplateProps,
  EndTemplateProps,
} from "../htmlTemplate";
import type { Context } from "koa";

interface ResponseOptions {
  transformHtml?: (html: string) => string | Promise<string>;
}

export const response = (
  ctx: Context,
  jsx: React.ReactElement,
  startTemplate: StartTemplateProps,
  endTemplate: EndTemplateProps,
  options: ResponseOptions = {}
) => {
  return new Promise((resolve, reject) => {
    let didShellError = false;
    const { pipe } = renderToPipeableStream(jsx, {
      async onShellReady() {
        ctx.status = 200;
        ctx.respond = false;

        try {
          const startHtml = getStartTemplate(startTemplate);
          const transformedStartHtml = options.transformHtml
            ? await options.transformHtml(startHtml)
            : startHtml;
          const body = new PassThrough();

          body.on("data", (chunk) => ctx.res.write(chunk));
          body.on("end", () => {
            ctx.res.end(getEndTemplate(endTemplate));
            resolve(true);
          });
          body.on("error", reject);

          ctx.res.write(transformedStartHtml);
          pipe(body);
        } catch (error) {
          reject(error);
        }
      },
      onShellError(error) {
        didShellError = true;
        console.error("Shell rendering error:", error);
        ctx.status = 500;
        reject(error);
      },
      onError(error) {
        console.error("Stream rendering error:", error);
        if (!didShellError) {
          ctx.status = 500;
        }
      },
    });
  });
};
