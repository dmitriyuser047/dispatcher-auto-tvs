'use strict';
(() => {
  const web=window.tvsWeb ||= {};let cached=null;
  web.bddsArticles=()=>{if(cached)return cached;const node=document.getElementById?.('tvs-bdds-articles');if(!node)return [];try{const value=JSON.parse(node.textContent);if(Array.isArray(value))cached=value.filter(item=>item&&typeof item.label==='string'&&item.label.trim());}catch{}return cached||[];};
})();
