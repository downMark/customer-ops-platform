interface RenderProps {
  appContent: string;
  linkTags: string;
  scriptTags: string;
  styleTags: string;
  htmlAttributes: string;
  bodyAttributes: string;
  helmetTags: string;
  dehydratedState: string;
}

export default ({
  appContent,
  linkTags,
  styleTags,
  scriptTags,
  htmlAttributes,
  bodyAttributes,
  helmetTags,
  dehydratedState,
}: RenderProps) =>
  `<!DOCTYPE html>
<html ${htmlAttributes}>
<head>
  ${helmetTags}
  ${linkTags}
  ${styleTags}
</head>
<body ${bodyAttributes}>
  <div id="root">${appContent}</div>
  <script id="__APP_FLAG__" type="application/json">{"isSSR": true}</script>
  <script id="__REACT_QUERY_STATE__" type="application/json">${dehydratedState}</script>
  ${scriptTags}
</body>
</html>`;
