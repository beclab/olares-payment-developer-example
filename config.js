/** Shared by the shop (`server.js`) and the one-file scripts in `examples/. */
export const CONFIG = {
  port: 32000,
  shopPublicUrl: 'http://127.0.0.1:32000',
  // Gateway base URL. The SDK defaults to https://www.olares.com/payment; point it
  // at a local gateway (e.g. http://127.0.0.1:31000) when developing against one.
  gatewayBaseUrl: 'http://127.0.0.1:31000',
  apiKey: 'pk_live_REPLACE_ME',
  apiSecret: 'sk_live_REPLACE_ME',
  webhookSecret: 'whsec_REPLACE_ME',
};
