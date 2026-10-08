"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import {useEffect,useState} from "react";
import {Bot} from "lucide-react";
export function SurveyantUsage(){const [count,setCount]=useState<number|null>(null);useEffect(()=>{let active=true;workspaceFetch("/api/v1/surveyant/usage").then(async r=>{const p=await r.json();if(active&&r.ok)setCount(p.data.messagesThisMonth);}).catch(()=>{});return()=>{active=false;};},[]);return <section className="panel"><header className="panel-header"><div><h2><Bot size={17}/> Surveyant usage</h2><p>Recorded conversational activity this month.</p></div></header><div className="panel-body"><strong style={{fontSize:28}}>{count??"—"}</strong><p>{count===null?"Usage records unavailable":"Grounded assistant answers recorded"}</p></div></section>;}
