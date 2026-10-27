// Thin facade: the public handler surface keeps its historical src/server.js
// import path while the implementation lives under src/server/.
export * from "./server/types.js";
export { createHandlers } from "./server/create-handlers.js";
