import { Http, HttpRouter } from "@golemcloud/effect-golem";

HttpRouter.define("Web", {
  mount: Http.mount("/assistant", {
    fileResponseHeaders: {
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  }),
  static: [
    { route: "/", path: "/web/index.html" },
    { route: "/assets/*", path: "/web/assets/$1" },
  ],
}).register();
