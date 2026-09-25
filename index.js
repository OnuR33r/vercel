// Vercel serverless entrypoint: just hand every request to the Express app.
const app = require("../server.js");

module.exports = app;
