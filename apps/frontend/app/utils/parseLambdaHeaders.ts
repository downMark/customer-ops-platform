const readOnlyHeaders = [
  "accept-encoding",
  "content-length",
  "if-modified-since",
  "if-none-Match",
  "if-range",
  "if-unmodified-since",
  "range",
  "transfer-encoding",
  "via",
];

export const parseLambdaHeaders = (headers) => {
  Object.keys(headers).reduce(
    (acc, key) => {
      let normalizedKey = key.toLowerCase();
      if (!readOnlyHeaders.includes(normalizedKey)) {
        if (acc[normalizedKey]) {
          acc[normalizedKey].push({
            key: normalizedKey,
            value: headers[key],
          });
        } else {
          acc[normalizedKey] = [
            {
              key: normalizedKey,
              value: headers[key],
            },
          ];
        }
      }
      return acc;
    },
    { "content-encoding": [{ key: "content-encoding", value: "gzip" }] }
  );
};
