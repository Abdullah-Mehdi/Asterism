// @ts-check
// Auto-loader: every sibling .js file becomes a registered command.
// Order is alphabetical by filename so /help renders predictably.
// Drop a new file with `{ data, ephemeral, execute }` and it gets picked up
// on the next process start — no edits to this file or to index.js needed.

const fs = require("fs");
const path = require("path");

const commands = fs.readdirSync(__dirname)
    .filter(f => f.endsWith(".js") && f !== "index.js")
    .sort()
    .map(f => require(path.join(__dirname, f)));

module.exports = commands;
