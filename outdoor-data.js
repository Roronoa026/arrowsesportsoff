(function(){
  const KEY='arrowsOutdoorToursV1';
  window.ARROWS_OUTDOOR={
    get(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){return[]}},
    save(rows){localStorage.setItem(KEY,JSON.stringify(rows));window.dispatchEvent(new Event('outdoor-data-changed'))},
    upsert(row){const a=this.get();const i=a.findIndex(x=>x.id===row.id);if(i>=0)a[i]=row;else a.unshift(row);this.save(a);return row},
    remove(id){this.save(this.get().filter(x=>x.id!==id))},
    id(){return (crypto.randomUUID?crypto.randomUUID():'out-'+Date.now()+'-'+Math.random().toString(16).slice(2))}
  };
})();
