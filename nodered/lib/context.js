"use strict";

const { createShared } = require("./shared");
const { createStore } = require("./store");
const { createFirebaseService } = require("./firebase");
const { createPublicService } = require("./public-status");

function createContext() {
  const shared = createShared();
  const store = createStore(shared);
  const ctx = { api: {}, ...shared, ...store };

  Object.assign(ctx, createFirebaseService(ctx));
  Object.assign(ctx, createPublicService(ctx));
  return ctx;
}

module.exports = { createContext };

