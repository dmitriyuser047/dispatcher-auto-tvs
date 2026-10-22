'use strict';
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'../..');
function source(filename){return fs.readFileSync(path.join(ROOT,filename),'utf8');}
function script(filename){const input=source(filename);return filename.endsWith('.html')?[...input.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).join('\n'):input;}
function parse(filename){const text=script(filename);return {text,tree:ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)};}
function functionDeclarations(filename,names){const {text,tree}=parse(filename),found=[];for(const node of tree.statements)if(ts.isFunctionDeclaration(node)&&node.name&&(!names||names.includes(node.name.text)))found.push(node.getText(tree));if(names)for(const name of names)if(!found.some(value=>new RegExp('(?:function\\s+)'+name+'\\s*\\(').test(value)))throw Error('Actual function missing: '+filename+':'+name);return found.join('\n');}
function ipcWrapper(filename='electron/main.js'){const {tree}=parse(filename);let found;function visit(node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.left.getText(tree)==='ipcMain.handle')found=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);if(!found)throw Error('Actual ipcMain.handle wrapper missing: '+filename);return found;}
function ipcHandler(channel,filename='electron/main.js'){const {tree}=parse(filename);let found;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='ipcMain.handle'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===channel)found=node.arguments[1].getText(tree);ts.forEachChild(node,visit);}visit(tree);if(!found)throw Error('Actual IPC handler missing: '+filename+':'+channel);return found;}
module.exports={ROOT,source,script,functionDeclarations,ipcWrapper,ipcHandler};
