module.exports = (api) => {
  const inDevelopment = api.cache(() => process.env.NODE_ENV === "development");

  return {
    presets: [
      [
        "@babel/preset-env",
        {
          useBuiltIns: "usage",
          corejs: {
            version: "3.30.1",
            proposals: true,
          },
        },
      ],
      [
        "@babel/preset-react",
        {
          runtime: "automatic",
        },
      ],
      ["@babel/preset-typescript", {}],
    ],
    plugins: [
      "@loadable/babel-plugin",
      [
        "@babel/plugin-transform-react-jsx",
        {
          runtime: "automatic",
        },
      ],
      "transform-commonjs",
      inDevelopment && "react-refresh/babel",
    ].filter(Boolean),
  };
};
