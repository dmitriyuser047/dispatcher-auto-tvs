'use strict';
const net=require('node:net');
const fail=message=>{throw Object.assign(Error(message),{code:'WEB_NETWORK_CONFIG'});};
function hostName(value){
  if(typeof value!=='string'||!value||value.length>253||value.trim()!==value)fail('Укажите имя компьютера или локальный IP без протокола и порта.');
  const host=value.toLowerCase();
  if(net.isIP(host))return host;
  if(!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))fail('Недопустимое имя компьютера.');
  return host;
}
function normalizeNetwork({host='127.0.0.1',allowedHosts=[]}={}){
  if(!['127.0.0.1','::1','localhost','0.0.0.0'].includes(host))fail('Для локалки используйте 0.0.0.0, для этого компьютера — 127.0.0.1.');
  if(!Array.isArray(allowedHosts)||allowedHosts.length>32)fail('Неверный список адресов диспетчера.');
  const names=[...new Set(allowedHosts.map(hostName))];
  if(host==='0.0.0.0'&&!names.length)fail('Для локальной сети укажите allowedHosts: имя сервера или его локальный IP.');
  return Object.freeze({host,allowedHosts:Object.freeze(names),lan:host==='0.0.0.0'});
}
function privateAddress(value){
  if(typeof value!=='string')return false;
  const address=value.toLowerCase().replace(/^::ffff:/,'');
  if(address==='::1')return true;
  if(net.isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return a===127||a===10||a===192&&b===168||a===172&&b>=16&&b<=31;
}
const authority=(host,port)=>(host.includes(':')?'['+host+']':host)+':'+port;
function requestAllowed(req,network,port){
  const host=req.headers.host;
  const names=new Set(['127.0.0.1','localhost','::1',...network.allowedHosts].map(name=>authority(name,port)));
  if(typeof host!=='string'||!names.has(host.toLowerCase()))return 'HOST_DENIED';
  const address=req.socket.remoteAddress;
  if(!privateAddress(address)||!network.lan&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address).toLowerCase()))return 'NETWORK_DENIED';
  if(req.headers.origin&&req.headers.origin!=='http://'+host)return 'ORIGIN_DENIED';
  if(req.headers['sec-fetch-site']==='cross-site')return 'ORIGIN_DENIED';
  return null;
}
module.exports={normalizeNetwork,privateAddress,requestAllowed};
