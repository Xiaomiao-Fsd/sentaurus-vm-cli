#!/usr/bin/env node
import process from "node:process";
import { executeCli } from "./index.js";

executeCli(process.argv.slice(2));
