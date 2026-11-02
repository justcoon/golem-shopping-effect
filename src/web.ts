import { Http, HttpRouter } from "@golemcloud/effect-golem";

const fileResponseHeaders = {
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

HttpRouter.define("WebAssistant", {
  mount: Http.mount("/assistant", {
    fileResponseHeaders,
  }),
  static: [
    { route: "/", path: "/web/assistant.html" },
    { route: "/assets/*", path: "/web/assets/$1" },
  ],
}).register();

HttpRouter.define("WebManager", {
  mount: Http.mount("/manager", {
    fileResponseHeaders,
  }),
  static: [
    { route: "/", path: "/web/manager.html" },
    { route: "/assets/*", path: "/web/assets/$1" },
  ],
}).register();
