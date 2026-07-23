import { createContext } from "react";
import { Context } from "koa";

const KoaContext = createContext<Context>(null);

export const KoaProvider = KoaContext.Provider
export const KoaConsumer = KoaContext.Consumer

export default KoaContext;