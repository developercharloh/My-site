// Disabled by Apollo (dtrader iframe). Apollo controls its own SW.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
