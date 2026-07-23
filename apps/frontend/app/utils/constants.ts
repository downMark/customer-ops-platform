import type { HelmetData } from "react-helmet-async";

export const helmetTagNameList: Array<keyof HelmetData["context"]["helmet"]> = [
  "meta",
  "link",
  "title",
  "style",
  "script",
];

export enum WindiMap {
  black = "dark",
  white = "light",
}

export const TempThemeMap = {
  black: WindiMap.black,
  white: WindiMap.white,
};

export const isBrowserEnv = (() => {
  let product;
  if (
    typeof navigator !== "undefined" &&
    ((product = navigator.product) === "ReactNative" ||
      product === "NativeScript" ||
      product === "NS")
  ) {
    return false;
  }

  return typeof window !== "undefined" && typeof document !== "undefined";
})();
