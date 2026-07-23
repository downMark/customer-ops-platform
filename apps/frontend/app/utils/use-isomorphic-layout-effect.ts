import { isBrowserEnv } from "./constants";
import { useLayoutEffect, useEffect } from "react";

const useIsomorphicLayoutEffect = isBrowserEnv ? useLayoutEffect : useEffect;

export default useIsomorphicLayoutEffect;
