(() => {
  const hostId = 'ig-saver-page-button';
  const reserved = new Set(['about','accounts','developer','direct','emails','explore','legal','p','privacy','reel','reels','stories','tv','web']);
  let pollingJob = false, lastOpenedItem = null, lastProfileUsername = null, scheduled = false;

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'ig-saver' || event.data?.type !== 'progress') return;
    chrome.runtime.sendMessage({...event.data,type:'download-progress'}).catch(()=>{});
    const button=document.querySelector(`#${hostId}`)?.shadowRoot?.querySelector('button');
    if(button && ['scanning','waiting'].includes(event.data.stage)){button.dataset.state='loading';button.disabled=true;button.querySelector('.label').textContent=event.data.stage==='waiting'?'Waiting for profile media...':`Scanning - page ${event.data.pages} - ${event.data.items} found`;}
  });
  window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='poststash-story-frame'&&event.data?.type==='changed')scheduleMount();});
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='ig-saver-job-started')pollJob();});

  function currentUsername(){const p=location.pathname.split('/').filter(Boolean);return p.length===1&&!reserved.has(p[0].toLowerCase())?p[0]:null;}
  function findName(){const main=document.querySelector('main');if(!main)return null;return [...main.querySelectorAll('h1,h2')].find(n=>n.getClientRects().length&&n.textContent.trim())||null;}
  function downloadIcon(label,onClick){
    const host=document.createElement('span');host.className='poststash-control';host.style.cssText='display:inline-flex;align-items:center;vertical-align:middle;margin:0 4px;';
    const shadow=host.attachShadow({mode:'open'}),button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;
    button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';
    button.style.cssText='all:unset;box-sizing:border-box;display:grid;place-items:center;width:24px;height:24px;border-radius:0;color:inherit;background:transparent;cursor:pointer;';
    button.addEventListener('mouseenter',()=>button.style.opacity='.65');button.addEventListener('mouseleave',()=>button.style.opacity='1');
    let resetTimer=0;button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();clearTimeout(resetTimer);button.disabled=true;button.style.opacity='.55';button.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="30 20"/></svg>';try{await onClick(button);button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';button.title=label;button.setAttribute('aria-label',label);resetTimer=setTimeout(()=>{button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';},1500);}catch(error){const message=/extension context invalid|context invalidated/i.test(error?.message||'')?'Extension reloaded. Refresh this Instagram tab, then try again.':error.message||'Download failed';button.title=message;button.setAttribute('aria-label',label);button.innerHTML='<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg>';}finally{button.disabled=false;button.style.opacity='1';}});
    shadow.append(button);return host;
  }
  function postItem(path){
    const match=path.match(/\/(p|reel|tv)\/([^/]+)\/?$/);
    return match?{group:match[2],category:match[1]==='p'?'posts':'reels'}:null;
  }
  function itemFromPage(){
    const item=postItem(location.pathname);
    if(item)return item;
    const dialog=document.querySelector('[role="dialog"]');
    if(!dialog)return null;
    for(const link of dialog.querySelectorAll('a[href]')){const linked=postItem(link.pathname);if(linked)return linked;}
    return lastOpenedItem;
  }
  function postActionRows(scope){
    const rows=[];
    for(const icon of scope.querySelectorAll('svg[aria-label="Share"],svg[aria-label="Send post"]')){
      if(!icon.getClientRects().length)continue;
      const anchor=icon.closest('button,[role="button"]');
      if(!anchor)continue;
      for(let row=anchor.parentElement,depth=0;row&&depth<5;row=row.parentElement,depth++){
        const labels=[...row.querySelectorAll('svg[aria-label]')].map(svg=>svg.getAttribute('aria-label'));
        if(labels.some(label=>/^(Like|Unlike)$/i.test(label))&&labels.includes('Comment')){
          if(!rows.some(control=>control.row===row))rows.push({row,anchor});
          break;
        }
      }
    }
    return rows;
  }
  function postDownloadHost(item,id){
    const host=downloadIcon('Download post or Reel',async button=>{
      const result=await chrome.runtime.sendMessage({type:'download-viewer-media',group:item.group,category:item.category,username:lastProfileUsername||currentUsername()});
      if(!result?.ok)throw new Error(result?.message||'Download failed');
      button.title=result.message||'Media downloaded';
    });
    host.id=id;host.dataset.group=item.group;
    host.shadowRoot.querySelector('button').style.cssText='all:unset;box-sizing:border-box;display:grid;place-items:center;width:40px;height:40px;padding:8px;color:inherit;background:transparent;cursor:pointer;';
    return host;
  }
  function insertBesideAction(host,anchor,row){
    let sibling=anchor;
    while(sibling.parentElement&&sibling.parentElement!==row)sibling=sibling.parentElement;
    if(sibling.parentElement!==row)return;
    if(!host.dataset.actionStyle){
      host.style.cssText='display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;align-self:center;margin:0;';
      host.dataset.actionStyle='native';
    }
    if(sibling.nextElementSibling!==host)row.insertBefore(host,sibling.nextElementSibling);
  }
  function mountPostDownload(){
    const dialog=document.querySelector('[role="dialog"]'),item=itemFromPage();
    const old=document.getElementById('poststash-post-download');
    if(!dialog&&!item){old?.remove();mountFeedPostDownloads();return;}
    for(const host of document.querySelectorAll('[data-poststash-feed-download]'))host.remove();
    const control=postActionRows(dialog||document)[0];
    if(!control||!item){old?.remove();return;}
    let host=old;
    if(host?.dataset.group!==item.group){host?.remove();host=postDownloadHost(item,'poststash-post-download');}
    insertBesideAction(host,control.anchor,control.row);
  }
  function mountFeedPostDownloads(){
    const existing=[...document.querySelectorAll('[data-poststash-feed-download]')],keep=new Set();
    for(const control of postActionRows(document.querySelector('main')||document)){
      const item=itemNear(control.row);
      if(!item)continue;
      const id=`poststash-feed-download-${item.group.replace(/[^a-z0-9_-]/gi,'_')}`;
      let host=document.getElementById(id);
      if(!host){host=postDownloadHost(item,id);host.dataset.poststashFeedDownload='true';}
      insertBesideAction(host,control.anchor,control.row);keep.add(host);
    }
    for(const host of existing)if(!keep.has(host))host.remove();
  }
  function itemNear(row){
    for(let root=row.parentElement,depth=0;root&&root!==document.body&&depth<12;root=root.parentElement,depth++){
      for(const link of root.querySelectorAll('a[href]')){const item=postItem(link.pathname);if(item)return item;}
    }
    return null;
  }
  let storyControl = null;
  function removeStoryControl(){
    if(!storyControl)return;
    storyControl.host.remove();
    storyControl=null;
  }
  function mountStoryDownload(){
    const media=document.querySelector('[data-poststash-story-active]');
    if(!media||!media.isConnected){removeStoryControl();return;}
    const version=media.getAttribute('data-poststash-story-active'),token=media.getAttribute('data-poststash-story-media');
    const category=media.getAttribute('data-poststash-story-category')||'stories';
    const r=media.getBoundingClientRect();
    if(r.width<120||r.height<120){removeStoryControl();return;}
    if(storyControl?.version!==version||storyControl?.media!==media){
      removeStoryControl();
      const activePath=location.pathname.split('/').filter(Boolean),highlight=category==='highlights';
      const username=highlight?(activePath[3]||lastProfileUsername||'instagram'):activePath[1]||lastProfileUsername||'instagram';
      const host=downloadIcon(highlight?'Download highlight':'Download story',async button=>{
        if(!host.isConnected||media.getAttribute('data-poststash-story-active')!==version)throw new Error('This Story changed. Use the download button in the current Story frame.');
        const storyClickId=host.dataset.storyClickId;
        if(!storyClickId)throw new Error('The Story click could not be captured. Try the current Story button again.');
        const result=await chrome.runtime.sendMessage({type:'download-viewer-media',category,username,storyClickId});
        if(!result?.ok)throw new Error(result?.message||'Could not download this Story.');
        button.title=result.message||'Story saved';
      });
      host.id='poststash-story-download';
      host.setAttribute('data-poststash-story-button',version);
      host.dataset.storyMediaToken=token;host.dataset.storyCategory=category;host.dataset.storyUsername=username;
      host.style.cssText='display:block;position:fixed;margin:0;z-index:2147483647;color:white;pointer-events:auto;';
      const button=host.shadowRoot.querySelector('button');
      button.style.color='white';button.style.background='transparent';button.style.width='36px';button.style.height='36px';
      button.addEventListener('mouseenter',()=>button.style.opacity='.65');
      button.addEventListener('mouseleave',()=>button.style.opacity='1');
      button.addEventListener('focus',()=>{button.style.outline='2px solid white';button.style.outlineOffset='2px';});
      button.addEventListener('blur',()=>button.style.outline='');
      document.documentElement.append(host);
      storyControl={host,media,version};
    }
    const left=Math.max(4,Math.min(innerWidth-40,r.right-44));
    const top=Math.max(4,Math.min(innerHeight-40,r.top+60));
    if(storyControl.host.style.left!==`${left}px`)storyControl.host.style.left=`${left}px`;
    if(storyControl.host.style.top!==`${top}px`)storyControl.host.style.top=`${top}px`;
  }
  document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null,a=target?.closest('a[href*="/p/"],a[href*="/reel/"],a[href*="/tv/"]');if(a){const m=a.pathname.match(/\/(p|reel|tv)\/([^/]+)/);if(m)lastOpenedItem={group:m[2],category:m[1]==='p'?'posts':'reels'};}},true);

  function mount(){
    mountPostDownload();mountStoryDownload();const username=currentUsername(),existing=document.getElementById(hostId);
    if(!username){existing?.remove();return;}lastProfileUsername=username;const name=findName();if(!name)return;
    if(existing?.dataset.username===username){if(!existing.isConnected)name.insertAdjacentElement('afterend',existing);return;}existing?.remove();
    const host=document.createElement('span');host.id=hostId;host.dataset.username=username;host.style.cssText='display:inline-flex;vertical-align:middle;margin:8px 0 8px 12px;';
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent='@keyframes spin{to{transform:rotate(360deg)}}.spinner{display:none;width:12px;height:12px;flex:0 0 auto;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}button[data-state="loading"] .spinner{display:block}button[data-state="loading"]{opacity:.65;cursor:wait}.label{overflow-wrap:anywhere;text-align:center}@media(prefers-color-scheme:dark){button{background:#363636!important;color:#f5f5f5!important}button:hover{background:#484848!important}}';
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-live','polite');button.setAttribute('aria-busy','false');button.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/></svg><span class="spinner" aria-hidden="true"></span><span class="label">Download all media</span>';
    button.style.cssText='all:unset;box-sizing:border-box;display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;padding:0 13px;border-radius:8px;background:#efefef;color:#262626;font:600 12px/1.2 "Instagram Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:normal;';
    button.addEventListener('mouseenter',()=>{if(!button.disabled)button.style.background='#dbdbdb';});button.addEventListener('mouseleave',()=>button.style.background='#efefef');button.addEventListener('focus',()=>{button.style.outline='2px solid #0095f6';button.style.outlineOffset='2px';});button.addEventListener('blur',()=>{button.style.outline='';button.style.outlineOffset='';});shadow.append(style,button);name.insertAdjacentElement('afterend',host);
    button.addEventListener('click',async()=>{button.disabled=true;button.dataset.state='loading';button.setAttribute('aria-busy','true');button.querySelector('.label').textContent='Starting...';try{const r=await chrome.runtime.sendMessage({type:'download-profile'});if(!r?.ok)throw new Error(r?.message||'Download could not start');button.querySelector('.label').textContent='Scanning profile...';pollJob();}catch(e){button.dataset.state='error';button.querySelector('.label').textContent=e.message||'Download could not start';}finally{if(!pollingJob){button.disabled=false;button.dataset.state='';button.setAttribute('aria-busy','false');}}});
  }
  async function pollJob(){if(pollingJob)return;pollingJob=true;try{while(true){const username=currentUsername();if(!username)return;try{const response=await chrome.runtime.sendMessage({type:'get-download-progress'}),job=response?.progress,button=document.querySelector(`#${hostId}`)?.shadowRoot?.querySelector('button');if(!job||job.username&&job.username.toLowerCase()!==username.toLowerCase())return;if(job.stage==='scanning')setButtonProgress(button,`Scanning - page ${job.pages} - ${job.items||0} found`,true);else if(job.stage==='waiting')setButtonProgress(button,'Waiting for profile media...',true);else if(job.stage==='downloading')setButtonProgress(button,`Downloading ${job.downloaded}/${job.total}`,true);else if(job.stage==='complete'){setButtonProgress(button,job.failed?`Done - ${job.failed} failed to start`:`Done - ${job.downloaded} downloads started`,false,job.message);return;}else if(job.stage==='error'){setButtonProgress(button,job.error||'Download failed.',false);return;}}catch{return;}await new Promise(r=>setTimeout(r,1000));}}finally{pollingJob=false;}}
  function setButtonProgress(button,text,loading,title=''){if(!button)return;button.querySelector('.label').textContent=text;button.dataset.state=loading?'loading':'done';button.disabled=loading;button.setAttribute('aria-busy',loading?'true':'false');button.title=title||text;}
  function scheduleMount(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});}
  const observer=new MutationObserver(scheduleMount);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-poststash-story-active','src','poster']});
  window.addEventListener('resize',scheduleMount);window.addEventListener('scroll',scheduleMount,true);
  window.addEventListener('popstate',scheduleMount);const push=history.pushState;history.pushState=function(...args){const r=push.apply(this,args);scheduleMount();return r;};
  setInterval(scheduleMount,1200);mount();
})();
