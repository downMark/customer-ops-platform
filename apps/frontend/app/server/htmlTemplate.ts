import { type FilledContext } from "react-helmet-async";
import { helmetTagNameList } from "@app/utils/constants";
import { type AssetTags } from "./assets";

export interface StartTemplateProps {
  helmetContext: FilledContext;
  assetTags: AssetTags;
}

export interface EndTemplateProps {
  dehydratedState: string;
  assetTags: AssetTags;
}

export const getStartTemplate = ({
  helmetContext,
  assetTags,
}: StartTemplateProps) => {
  return `<!DOCTYPE html>
<html ${helmetContext?.helmet?.htmlAttributes.toString()}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${helmetTagNameList
    .map((tagName) => helmetContext?.helmet?.[tagName].toString())
    .join("")}
  ${assetTags.links}
</head>
<body ${helmetContext?.helmet?.bodyAttributes.toString()}>
  <div id="root">`;
};

export const getEndTemplate = ({
  dehydratedState,
  assetTags,
}: EndTemplateProps) => {
  return `</div>
  <script id="__APP_FLAG__" type="application/json">{"isSSR": true}</script>
  <script id="__REACT_QUERY_STATE__" type="application/json">${dehydratedState}</script>
  ${assetTags.scripts}
</body>
</html>`;
};
