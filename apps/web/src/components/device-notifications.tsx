"use client";
import { useEffect,useState } from "react";
import { deviceAlertKey,newDeviceEvents,showDeviceAlert,type DeviceEvent } from "@/lib/device-notifications";
export function DeviceNotificationSettings(){
  const [permission,setPermission]=useState("checking"),[enabled,setEnabled]=useState(false),[message,setMessage]=useState(""),[scope,setScope]=useState("");
  useEffect(()=>{let active=true;Promise.resolve().then(async()=>{try{const response=await fetch("/api/v1/me/notifications",{cache:"no-store"});if(!response.ok)throw new Error();const payload=await response.json(),scope=payload.meta?.notificationScope??"preview";if(active){setScope(scope);setPermission("Notification" in window&&"serviceWorker" in navigator&&window.isSecureContext?Notification.permission:"unsupported");setEnabled(localStorage.getItem(`${deviceAlertKey}:${scope}`)==="enabled");}}catch{if(active){setPermission("unsupported");setMessage("Sign in again or reload to manage device notification settings.");}}});return()=>{active=false;};},[]);
  async function enable(){
    try{const result=await Notification.requestPermission();setPermission(result);if(result==="granted"){await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});localStorage.setItem(`${deviceAlertKey}:${scope}`,"enabled");localStorage.setItem(deviceAlertKey,"enabled");setEnabled(true);window.dispatchEvent(new Event("surveynt-device-alerts"));setMessage("Device alerts enabled while Surveynt is open.");}else setMessage("Notification permission was not granted. You can change it in your browser site settings.");}catch{setMessage("This browser could not enable device alerts.");}
  }
  function disable(){localStorage.removeItem(`${deviceAlertKey}:${scope}`);setEnabled(false);window.dispatchEvent(new Event("surveynt-device-alerts"));setMessage("Surveynt device alerts for this account are off. Browser permission remains unchanged.");}
  return <section><h3>Device notifications</h3><p>Permission: {permission}. New permitted operational events can alert this device while Surveynt is open, including in a background tab. Closing the app stops polling; background push requires separate server configuration.</p><p>Alerts contain generic text to protect customer details on lock screens.</p>{enabled?<button className="button button-secondary" onClick={disable}>Turn off device alerts</button>:<button className="button button-primary" disabled={["checking","unsupported","denied"].includes(permission)} onClick={()=>void enable()}>Enable device alerts</button>}<button className="button button-secondary" disabled={!enabled||permission!=="granted"} onClick={()=>void showDeviceAlert("This is a test notification. No customer records were changed.","surveynt-test").then(()=>setMessage("Test notification sent to this device.")).catch(()=>setMessage("The browser could not show the test notification."))}>Send test notification</button>{permission==="denied"?<p>Unblock notifications for this site in your browser settings to enable alerts.</p>:null}<p role="status">{message}</p></section>;
}
export function DeviceNotificationListener({slug}:{slug:string}){
  useEffect(()=>{
    let stopped=false,inFlight=false;
    async function poll(){
      if(stopped||inFlight||!("Notification" in window)||Notification.permission!=="granted"||localStorage.getItem(deviceAlertKey)!=="enabled")return;
      inFlight=true;
      try{
        const response=await fetch("/api/v1/me/notifications",{cache:"no-store"});if(!response.ok)return;
        const payload=await response.json(),scope=payload.meta?.notificationScope;if(!scope||localStorage.getItem(`${deviceAlertKey}:${scope}`)!=="enabled")return;
        const key=`surveynt:seen-alerts:${scope}`,stored=localStorage.getItem(key),rows=payload.data as DeviceEvent[],seen=stored?JSON.parse(stored) as string[]:null;
        // First load establishes a baseline: do not notify for old audit history.
        const deliver=async()=>{if(stopped||localStorage.getItem(`${deviceAlertKey}:${scope}`)!=="enabled")return;const fresh=localStorage.getItem(key);const current=fresh?JSON.parse(fresh) as string[]:seen;const unseen=current?newDeviceEvents(rows,current):[];for(const row of unseen.slice(0,3))await showDeviceAlert("There is a new update in your Surveynt workspace.",`surveynt:${scope}:${row.id}`,row.href.replace("{slug}",slug));localStorage.setItem(key,JSON.stringify([...new Set([...rows.map(row=>row.id),...(current??[])])].slice(0,200)));};
        if(navigator.locks)await navigator.locks.request(key,deliver);else await deliver();
      }catch{/* Offline/provider failure: retry without repeated alerts. */}finally{inFlight=false;}
    }
    void poll();const interval=setInterval(()=>void poll(),60000);window.addEventListener("surveynt-device-alerts",poll);
    return()=>{stopped=true;clearInterval(interval);window.removeEventListener("surveynt-device-alerts",poll);};
  },[slug]);
  return null;
}
