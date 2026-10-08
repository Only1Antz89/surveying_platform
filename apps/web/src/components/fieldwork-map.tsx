"use client";
import { useEffect, useRef, useState } from "react";
import { Layers, LocateFixed, Pause, Play, X } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map, Marker } from "maplibre-gl";
import { boundedFieldContext, interpolateRoad, journeySections, type FieldworkRoute } from "@/lib/fieldwork";
import type { PropertyMapView } from "@/lib/property-map";

const configuredStyle=process.env.NEXT_PUBLIC_MAP_STYLE_URL;
const styleUrl=configuredStyle??(process.env.NODE_ENV==="development"?"https://tiles.openfreemap.org/styles/bright":undefined);
const imageryUrl=process.env.NEXT_PUBLIC_FIELD_SATELLITE_TILES;
const imageryCredit=process.env.NEXT_PUBLIC_FIELD_SATELLITE_ATTRIBUTION;
const terrainUrl=process.env.NEXT_PUBLIC_FIELD_TERRAIN_URL;
const terrainCredit=process.env.NEXT_PUBLIC_FIELD_TERRAIN_ATTRIBUTION;
const contextUrl=process.env.NEXT_PUBLIC_FIELD_CONTEXT_URL;
const empty={type:"FeatureCollection" as const,features:[]};
export function FieldworkMap({route,selected,onSelect,journey,evidence}:{route:FieldworkRoute;selected:string;onSelect:(id:string)=>void;journey:boolean;evidence:PropertyMapView|null}){
 const container=useRef<HTMLDivElement>(null),mapRef=useRef<Map|null>(null),markers=useRef<{id:string;marker:Marker}[]>([]),callback=useRef(onSelect),selectedRef=useRef(selected),motion=useRef<()=>void>(()=>{}),panelRef=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null);
 const treeController=useRef<{setVisible:(visible:boolean)=>void}|null>(null),toolbar=useRef<HTMLDivElement>(null);
 const [derivedAvailable,setDerivedAvailable]=useState(false),[onlyDerived,setOnlyDerived]=useState(false);
 const [ready,setReady]=useState(false),[error,setError]=useState(""),[view,setView]=useState("map"),[threeD,setThreeD]=useState(true),[buildings,setBuildings]=useState(true),[contextVisible,setContextVisible]=useState(true),[contextCredit,setContextCredit]=useState(""),[panel,setPanel]=useState<"layers"|"view"|null>(null),[hidden,setHidden]=useState<Record<string,boolean>>({}),[playing,setPlaying]=useState(false),[orbit,setOrbit]=useState(false),[reduced,setReduced]=useState(false),[buildingAvailable,setBuildingAvailable]=useState(false);
 useEffect(()=>{callback.current=onSelect;selectedRef.current=selected;},[onSelect,selected]);
 useEffect(()=>{const q=matchMedia("(prefers-reduced-motion: reduce)"),update=()=>setReduced(q.matches||document.documentElement.dataset.motion==="reduced");update();q.addEventListener("change",update);const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true});return()=>{q.removeEventListener("change",update);observer.disconnect();};},[]);
 function closePanel(){setPanel(null);trigger.current?.focus();}
 useEffect(()=>{if(!panel)return;if(panelRef.current&&toolbar.current)panelRef.current.style.top=`${toolbar.current.offsetHeight+8}px`;panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();const close=(e:PointerEvent)=>{if(!panelRef.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPanel(null);};document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close);},[panel]);
 useEffect(()=>{
  let disposed=false;const abort=new AbortController();const resources:Marker[]=[];
  (async()=>{try{
   const lib=await import("maplibre-gl");lib.setWorkerUrl(`/vendor/maplibre-gl/${lib.getVersion()}/maplibre-gl-worker.mjs`);
   if(disposed||!container.current)return;
   const first=route.stops.find(s=>s.coordinates)?.coordinates??route.origin;
   const map=new lib.Map({container:container.current,style:styleUrl??{version:8,sources:{},layers:[{id:"field-background",type:"background",paint:{"background-color":"#e9eff7"}}]},center:first?[first.longitude,first.latitude]:[-2.6,51.45],zoom:first?15:6,pitch:48,cooperativeGestures:true,attributionControl:{compact:true,customAttribution:process.env.NEXT_PUBLIC_MAP_ATTRIBUTION??(configuredStyle?undefined:"Development basemap · OpenFreeMap / OpenStreetMap")}});mapRef.current=map;
   map.addControl(new lib.NavigationControl({showCompass:true,showZoom:true}),"top-right");map.addControl(new lib.ScaleControl());
   map.on("error",()=>{if(!disposed)setError("Some map tiles or overlays could not load. The itinerary and property records remain available.");});
   map.on("dragstart",()=>motion.current());map.on("zoomstart",event=>{if(event.originalEvent)motion.current();});map.on("rotatestart",event=>{if(event.originalEvent)motion.current();});
   map.on("load",async()=>{
    if(disposed)return;
    map.addSource("field-road",{type:"geojson",data:route.provider.geometry?{type:"Feature",properties:{},geometry:route.provider.geometry}:empty});
    map.addLayer({id:"field-road",type:"line",source:"field-road",paint:{"line-color":"#2563eb","line-width":4,"line-opacity":.8}});
    for(const layer of map.getStyle().layers)if(layer.type==="fill-extrusion")map.setLayoutProperty(layer.id,"visibility","none");
    const vector=map.getStyle().sources;const buildingSource=process.env.NEXT_PUBLIC_FIELD_BUILDING_SOURCE??Object.keys(vector).find(id=>vector[id].type==="vector");
    if(buildingSource){map.addLayer({id:"field-buildings",type:"fill-extrusion",source:buildingSource,"source-layer":process.env.NEXT_PUBLIC_FIELD_BUILDING_LAYER??"building",minzoom:14,paint:{"fill-extrusion-color":"#90a8c6","fill-extrusion-height":["max",0,["to-number",["coalesce",["get","render_height"],["get","height"],8]]],"fill-extrusion-base":["max",0,["to-number",["coalesce",["get","render_min_height"],["get","min_height"],0]]],"fill-extrusion-opacity":.88}});setBuildingAvailable(true);}
    if(imageryUrl?.startsWith("https://")&&imageryCredit){map.addSource("field-satellite",{type:"raster",tiles:[imageryUrl],tileSize:256,attribution:imageryCredit});map.addLayer({id:"field-satellite",type:"raster",source:"field-satellite",layout:{visibility:"none"}},"field-road");}
    if(terrainUrl?.startsWith("https://")&&terrainCredit){map.addSource("field-terrain",{type:"raster-dem",url:terrainUrl,encoding:"terrarium",tileSize:512,attribution:terrainCredit});}
    for(const stop of route.stops){if(!stop.coordinates)continue;const el=document.createElement("button");el.className="field-map-marker";el.textContent=String(route.stops.indexOf(stop)+1);el.setAttribute("aria-label",`Select ${stop.address}`);el.setAttribute("aria-pressed",String(stop.id===selectedRef.current));el.onclick=e=>{e.stopPropagation();motion.current();callback.current(stop.id);};const marker=new lib.Marker({element:el}).setLngLat([stop.coordinates.longitude,stop.coordinates.latitude]).addTo(map);resources.push(marker);markers.current.push({id:stop.id,marker});}
    if(route.origin){const el=document.createElement("span");el.className="field-map-origin";el.textContent="Base";resources.push(new lib.Marker({element:el}).setLngLat([route.origin.longitude,route.origin.latitude]).addTo(map));}
    setReady(true);
    if(contextUrl?.startsWith("https://"))try{
     const response=await fetch(contextUrl,{signal:abort.signal});const text=await response.text();if(text.length>8_000_000)throw Error("Context exceeds size limit");const data=boundedFieldContext(JSON.parse(text),route.stops.flatMap(s=>s.coordinates?[s.coordinates]:[]));
     if(disposed||!response.ok||!data)return;
     map.addSource("field-context",{type:"geojson",data:data.featureCollection as never,attribution:data.attribution});
     map.addLayer({id:"field-green",type:"fill",source:"field-context",filter:["in",["get","kind"],["literal",["park","garden","green_space"]]],paint:{"fill-color":"#86b88d","fill-opacity":.4}});
     map.addLayer({id:"field-landmarks",type:"circle",source:"field-context",filter:["==",["get","kind"],"landmark"],paint:{"circle-radius":5,"circle-color":"#2563eb","circle-stroke-color":"#ffffff","circle-stroke-width":2}});
     map.addLayer({id:"field-derived-buildings",type:"fill-extrusion",source:"field-context",filter:["==",["get","kind"],"building"],paint:{"fill-extrusion-color":"#7299c5","fill-extrusion-height":["get","height_m"],"fill-extrusion-opacity":.95}});
     setDerivedAvailable(data.featureCollection.features.some(f=>f.properties.kind==="building"));
     const treeFeatures=data.featureCollection.features.filter(f=>f.geometry.type==="Point"&&f.properties?.kind==="tree");
     if(treeFeatures.length){const moduleUrl="/fieldwork/tree-models.js";const treeModule=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleUrl);if(!disposed)treeController.current=treeModule.addTreeModels(map,treeFeatures,lib.MercatorCoordinate);}
     setContextCredit(`${data.attribution}. ${data.caveat??"Mapped context; completeness, species and condition unverified."}`);
    }catch{if(!disposed)setContextCredit("Landscape context unavailable; not checked.");}
   });
  }catch{if(!disposed)setError("Interactive mapping is unavailable on this device. Use the itinerary and navigation links.");}})();
  return()=>{disposed=true;abort.abort();resources.forEach(m=>m.remove());markers.current=[];mapRef.current?.remove();mapRef.current=null;treeController.current=null;};
 },[route]);
 useEffect(()=>{if(!ready)return;const map=mapRef.current!;map.easeTo({pitch:threeD?48:0,duration:reduced?0:900});if(map.getLayer("field-buildings"))map.setLayoutProperty("field-buildings","visibility",threeD&&buildings&&!onlyDerived?"visible":"none");if(map.getLayer("field-derived-buildings"))map.setLayoutProperty("field-derived-buildings","visibility",threeD&&buildings?"visible":"none");treeController.current?.setVisible(contextVisible&&threeD);for(const id of ["field-green","field-landmarks"])if(map.getLayer(id))map.setLayoutProperty(id,"visibility",contextVisible&&(id!=="natural-tree-models"||threeD)?"visible":"none");if(map.getLayer("field-satellite"))map.setLayoutProperty("field-satellite","visibility",view==="satellite"?"visible":"none");if(map.getSource("field-terrain"))map.setTerrain(view==="terrain"?{source:"field-terrain",exaggeration:1}:null);},[ready,view,threeD,buildings,onlyDerived,contextVisible,reduced,contextCredit]);
 useEffect(()=>{
  if(!ready||!mapRef.current)return;const map=mapRef.current,added:string[]=[];
  for(const layer of evidence?.layers??[]){const id=`field-evidence-${layer.id}`,flood=layer.layer.toLowerCase();const colour=/zone.?3|fz3/.test(flood)?"#1d4ed8":/zone.?2|fz2/.test(flood)?"#38bdf8":"#8b5cf6";map.addSource(id,{type:"geojson",data:layer.featureCollection as never,attribution:layer.attribution});map.addLayer({id,type:"fill",source:id,filter:["==",["geometry-type"],"Polygon"],layout:{visibility:hidden[layer.id]?"none":"visible"},paint:{"fill-color":colour,"fill-opacity":.28}});map.addLayer({id:`${id}-outline`,type:"line",source:id,layout:{visibility:hidden[layer.id]?"none":"visible"},paint:{"line-color":colour,"line-width":1.5}});added.push(id);}
  return()=>{for(const id of added){if(map.getLayer(`${id}-outline`))map.removeLayer(`${id}-outline`);if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);}};
 },[ready,evidence,hidden]);
 useEffect(()=>{const map=mapRef.current;if(!ready||!map)return;for(const m of markers.current)m.marker.getElement().setAttribute("aria-pressed",String(m.id===selected));const stop=route.stops.find(s=>s.id===selected);if(stop?.coordinates)map.easeTo({center:[stop.coordinates.longitude,stop.coordinates.latitude],zoom:16,pitch:threeD?48:0,duration:reduced?0:1800});},[ready,selected,route,threeD,reduced]);
 useEffect(()=>{
  motion.current=()=>{setPlaying(false);setOrbit(false);};if(!ready||reduced||(!playing&&!orbit)||!mapRef.current)return;
  const map=mapRef.current;let frame=0,cancelled=false,marker:Marker|null=null;const start=performance.now();
  const stop=()=>{setPlaying(false);setOrbit(false);};const visibility=()=>{if(document.hidden)stop();};document.addEventListener("visibilitychange",visibility);
  if(playing&&route.provider.geometry)(async()=>{const lib=await import("maplibre-gl");if(cancelled)return;const el=document.createElement("span");el.className="field-direction";el.textContent="➤";el.setAttribute("aria-label","Animated planned direction, not GPS");marker=new lib.Marker({element:el,rotationAlignment:"map"}).setLngLat(route.provider.geometry!.coordinates[0]).addTo(map);})();
  const sections=journeySections(route),initialBearing=map.getBearing();let lastSection=-1;
  function tick(now:number){if(cancelled)return;
   if(playing){const elapsed=now-start,sectionIndex=Math.floor(elapsed/87000),section=sections[sectionIndex];if(!section){stop();return;}if(lastSection!==sectionIndex){lastSection=sectionIndex;callback.current(section.stopId);}
    const fraction=Math.min(1,(elapsed%87000)/75000),p=interpolateRoad(section.points,fraction),next=interpolateRoad(section.points,Math.min(1,fraction+.002));
    if(p&&next){marker?.setLngLat(p);const bearing=Math.atan2((next[0]-p[0])*Math.cos(p[1]*Math.PI/180),next[1]-p[1])*180/Math.PI;if(fraction<1){marker?.setRotation(bearing-90);map.jumpTo({center:p,zoom:16,pitch:48,bearing});}}
   }else map.jumpTo({bearing:initialBearing+(now-start)/1000*3});frame=requestAnimationFrame(tick);
  }frame=requestAnimationFrame(tick);
  return()=>{cancelled=true;cancelAnimationFrame(frame);marker?.remove();document.removeEventListener("visibilitychange",visibility);};
 },[ready,playing,orbit,route,reduced]);
 useEffect(()=>{if(!journey)motion.current();},[journey]);
 function fit(){motion.current();const points=route.stops.flatMap(s=>s.coordinates?[[s.coordinates.longitude,s.coordinates.latitude] as [number,number]]:[]);if(route.origin)points.push([route.origin.longitude,route.origin.latitude]);if(!points.length)return;mapRef.current?.fitBounds([[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]],{padding:70,maxZoom:16,duration:reduced?0:1400});}
 const count=(buildings&&threeD&&(buildingAvailable||derivedAvailable)?1:0)+(contextVisible&&contextCredit?1:0)+(evidence?.layers.filter(l=>!hidden[l.id]).length??0);
 return <section className="panel fieldwork-map-panel" aria-label="Interactive fieldwork map">
  <div ref={toolbar} className="field-map-toolbar"><div className="field-map-segment" aria-label="Basemap">{["map","satellite","terrain"].map(v=><button key={v} disabled={v==="satellite"?!(imageryUrl&&imageryCredit):v==="terrain"?!(terrainUrl&&terrainCredit):false} title={v!=="map"?"Requires configured, attributed provider":"Street map"} aria-pressed={view===v} onClick={()=>{motion.current();setView(v);}}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div><div className="field-map-segment" aria-label="Projection">{[true,false].map(v=><button key={String(v)} aria-pressed={threeD===v} onClick={()=>{motion.current();setThreeD(v);}}>{v?"3D":"2D"}</button>)}</div><button aria-expanded={panel==="layers"} aria-controls="field-layers" aria-haspopup="dialog" onClick={e=>{trigger.current=e.currentTarget;setPanel(panel==="layers"?null:"layers");}}><Layers size={14}/>Layers · {count}</button><button aria-expanded={panel==="view"} aria-controls="field-views" aria-haspopup="dialog" onClick={e=>{trigger.current=e.currentTarget;setPanel(panel==="view"?null:"view");}}>View options</button></div>
  <div className="field-map-status" role="status">{!styleUrl?"Basemap setup required · overlays remain available":view==="terrain"?"Terrain · true scale (1×)":view==="satellite"?"Provider imagery · not live photography":"Map"} · {evidence?.layers.length?"Property-centred reference data":"Reference data not checked"}</div>
  {panel?<div ref={panelRef} id={panel==="layers"?"field-layers":"field-views"} role="dialog" aria-label={panel==="layers"?"Map layers":"View options"} className="field-map-popover" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();closePanel();}}}><header><strong>{panel==="layers"?"Map layers":"View options"}</strong><button aria-label="Close map options" onClick={closePanel}><X size={17}/></button></header>{panel==="layers"?<><fieldset><legend>Buildings & landscape</legend><label><span><strong>3D buildings</strong><small>Recorded heights where supplied; otherwise estimated. Not surveyed roof models.</small></span><input type="checkbox" checked={buildings} disabled={!buildingAvailable&&!derivedAvailable} onChange={e=>setBuildings(e.target.checked)}/></label><label><span><strong>Evidence-derived heights only</strong><small>Hide generic buildings. Historical estimates, not current surveyed heights.</small></span><input type="checkbox" checked={onlyDerived} disabled={!derivedAvailable} onChange={e=>setOnlyDerived(e.target.checked)}/></label><label><span><strong>Trees, parks & landmarks</strong><small>{contextCredit||"Bounded context provider setup required. Tree forms are symbolic."}</small></span><input type="checkbox" checked={contextVisible} disabled={!contextCredit||contextCredit.startsWith("Landscape context unavailable")} onChange={e=>setContextVisible(e.target.checked)}/></label></fieldset><fieldset><legend>Property reference layers</legend>{evidence?.layers.map(l=><label key={l.id}><span><strong>{l.label}</strong><small>{l.caveat} · version {l.datasetVersion}</small></span><input type="checkbox" checked={!hidden[l.id]} onChange={e=>setHidden(old=>({...old,[l.id]:!e.target.checked}))}/></label>)}{evidence?.notChecked.map(n=><p key={n.label}><strong>{n.label}</strong>: {n.reason}</p>)}{!evidence?<p>Loading or unavailable. No absence or safety conclusion can be drawn.</p>:null}</fieldset><p>Flood Zone 2/3 are separate planning layers, not live floods, water depth or property-risk certification. Data is limited to the selected property&apos;s vicinity.</p></>:<><button onClick={fit}><LocateFixed size={15}/>Fit whole day</button><button disabled={!ready||reduced} aria-pressed={orbit} onClick={()=>{setPlaying(false);setOrbit(!orbit);}}>{orbit?"Stop orbit":"Orbit selected inspection"}</button><p>Camera animation is disabled when reduced motion is enabled.</p></>}</div>:null}
  {journey?<div className="field-journey-controls"><button className="button button-primary" disabled={!ready||reduced||!route.provider.geometry} onClick={()=>{setOrbit(false);setThreeD(true);setPlaying(!playing);}}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?"Pause journey":"Preview journey"}</button><span>{!route.provider.geometry?"Road routing required for playback":"75 seconds per leg · 12-second inspection pauses · not GPS"}</span></div>:null}
  <div ref={container} className="fieldwork-canvas" role="region" aria-label="Map of permitted inspections and property context"/>
  {error?<p className="field-map-status" role="alert">{error}</p>:null}<footer>Indicative map context · not legal boundaries. {route.provider.attribution}</footer>
 </section>;
}
