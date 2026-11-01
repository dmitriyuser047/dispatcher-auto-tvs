'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeNetwork,privateAddress,requestAllowed}=require('../web/network.cjs');
test('LAN requires an explicit bind and bounded exact host names',()=>{
  assert.equal(normalizeNetwork().host,'127.0.0.1');
  assert.deepEqual([...normalizeNetwork({host:'0.0.0.0',allowedHosts:['TVS-SERVER','192.168.1.8','TVS-SERVER']}).allowedHosts],['tvs-server','192.168.1.8']);
  for(const input of [{host:'8.8.8.8'},{host:'0.0.0.0'},{allowedHosts:['http://server']},{allowedHosts:['server:3381']},{allowedHosts:['server/path']},{allowedHosts:['*.company']}])assert.throws(()=>normalizeNetwork(input),{code:'WEB_NETWORK_CONFIG'});
});
test('only private LAN sources, exact Host and same Origin reach the gateway',()=>{
  const network=normalizeNetwork({host:'0.0.0.0',allowedHosts:['tvs-server','192.168.1.8']}),req={headers:{host:'tvs-server:3381',origin:'http://tvs-server:3381'},socket:{remoteAddress:'192.168.1.11'}};
  assert.equal(requestAllowed(req,network,3381),null);
  assert.equal(requestAllowed({...req,socket:{remoteAddress:'8.8.8.8'}},network,3381),'NETWORK_DENIED');
  assert.equal(requestAllowed({...req,headers:{host:'attacker.invalid:3381'}},network,3381),'HOST_DENIED');
  assert.equal(requestAllowed({...req,headers:{...req.headers,origin:'http://attacker.invalid'}},network,3381),'ORIGIN_DENIED');
  assert.equal(requestAllowed({...req,headers:{...req.headers,'sec-fetch-site':'cross-site'}},network,3381),'ORIGIN_DENIED');
  assert.equal(requestAllowed({headers:{host:'localhost:3381'},socket:{remoteAddress:'192.168.1.11'}},normalizeNetwork(),3381),'NETWORK_DENIED');
  for(const ip of ['127.0.0.1','::1','::ffff:192.168.1.11','10.1.2.3','172.16.1.1','172.31.2.2'])assert.equal(privateAddress(ip),true);
  for(const ip of ['172.15.0.1','172.32.0.1','192.169.0.1','0.0.0.0','1.2.3.4','invalid'])assert.equal(privateAddress(ip),false);
});
