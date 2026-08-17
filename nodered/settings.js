const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env"),
  quiet: true
});

module.exports = {
  flowFile: "flows.json",
  flowFilePretty: true,
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,

  uiPort: Number(process.env.PORT) || 1880,
  httpAdminRoot: "/red",

  httpStatic: [
    { path: path.resolve(__dirname, "..", "website"), root: "/" },
    { path: path.resolve(__dirname, "node_modules", "chart.js", "dist"), root: "/vendor/chartjs" }
  ],

  functionGlobalContext: {
    aquaServices: require("./lib/aqua-services")
  },

  editorTheme: {
    projects: { enabled: false }
  },

  mqttReconnectTime: 15000,
  debugMaxLength: 1000
};
