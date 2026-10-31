(() => {
  "use strict";

  // This is the only value to change when selecting a new site-wide default.
  const DEFAULT_TYPOGRAPHY = "iming-garamond";
  const QUERY_PARAMETER = "typography";
  const TYPOGRAPHY_SCHEMES = Object.freeze({
    "iming-garamond": Object.freeze({
      preloads: Object.freeze([
        Object.freeze({
          href: "./assets/fonts/daodao-garamond-roman.woff2?v=a1487ddd96e6",
          type: "font/woff2",
        }),
        Object.freeze({
          href: "./assets/fonts/daodao-ming-regular.woff2?v=a33ea008f320",
          type: "font/woff2",
        }),
      ]),
    }),
    "noto-system": Object.freeze({
      preloads: Object.freeze([
        Object.freeze({
          href: "./assets/fonts/noto-serif-300.ttf",
          type: "font/ttf",
        }),
      ]),
    }),
  });

  const requestedTypography = new URLSearchParams(window.location.search).get(
    QUERY_PARAMETER
  );
  const hasRequestedTypography = Object.prototype.hasOwnProperty.call(
    TYPOGRAPHY_SCHEMES,
    requestedTypography
  );
  const activeTypography = hasRequestedTypography
    ? requestedTypography
    : DEFAULT_TYPOGRAPHY;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const isApplePlatform = /^(Mac|iPhone|iPad|iPod)/.test(platform);

  document.documentElement.dataset.typography = activeTypography;
  document.documentElement.dataset.applePlatform = String(isApplePlatform);

  for (const font of TYPOGRAPHY_SCHEMES[activeTypography].preloads) {
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.href = font.href;
    preload.as = "font";
    preload.type = font.type;
    preload.crossOrigin = "anonymous";
    document.head.append(preload);
  }
})();
