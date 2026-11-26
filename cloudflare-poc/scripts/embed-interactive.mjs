import {build} from "esbuild";
import {writeFileSync} from "node:fs";
const result=await build({entryPoints:["src/browser/entry.tsx"],bundle:true,write:false,format:"iife",platform:"browser",target:"es2022",minify:true,define:{"process.env.NODE_ENV":'"production"'},legalComments:"eof"});
writeFileSync(".generated/interactive.js",result.outputFiles[0].text);
writeFileSync("src/generated-interactive.ts","// Generated browser bundle; no request data.\nexport default "+JSON.stringify(result.outputFiles[0].text)+";\n");
