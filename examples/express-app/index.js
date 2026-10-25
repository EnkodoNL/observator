// SPDX-License-Identifier: FSL-1.1-ALv2
const express = require("express");
const { capitalize } = require("lodash");

const app = express();
app.get("/", (_req, res) => res.send(`${capitalize("hello")} from Node ${process.version}\n`));
app.listen(process.env.PORT || 3000);
