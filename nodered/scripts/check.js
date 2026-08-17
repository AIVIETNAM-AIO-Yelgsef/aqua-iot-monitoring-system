"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const library = path.join(root, "lib");

for (const name of fs.readdirSync(library).filter(name => name.endsWith(".js")).sort()) {
  execFileSync(process.execPath, ["--check", path.join(library, name)], { stdio: "inherit" });
}

JSON.parse(fs.readFileSync(path.join(root, "flows.json"), "utf8"));
console.log("Node-RED modules and flows: valid");

