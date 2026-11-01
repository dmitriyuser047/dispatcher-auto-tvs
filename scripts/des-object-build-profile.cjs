'use strict';
// One shared application, two immutable packaged identities and update channels.
const VERSION='0.1.0';
function metadata(source){return {...source,name:'dispatcher-des-object',version:VERSION,tvsProductProfile:'des-object',coreVersion:source.version,description:'Учёт ДЭС одного объекта с обменом данными с центральным Диспетчером',build:{...source.build,appId:'com.tvs.dispatcher-des-object',productName:'ДЭС объекта',executableName:'DES Object',artifactName:'Des-Object-Setup-${version}.${ext}',nsis:{...source.build.nsis,guid:'89f3a1a5-96e6-4440-a083-232c4b913dae',deleteAppDataOnUninstall:false}}};}
module.exports={VERSION,metadata};
