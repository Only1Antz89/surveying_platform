"use client";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Camera, UserRound } from "lucide-react";
import "./personal-profile.css";
type Profile={firstName:string;lastName:string;imageUrl:string};
function ProfileForm({initial,onSave,onPhoto,preview=false}:{initial:Profile;onSave:(value:Profile)=>Promise<void>;onPhoto:(file:File)=>Promise<string>;preview?:boolean}){
  const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function save(){setBusy(true);try{await onSave(value);setMessage(preview?"Profile saved on this device for demo use.":"Profile updated.");}catch{setMessage("The profile could not be saved. Please try again.");}finally{setBusy(false);}}
  async function photo(file?:File){if(!file)return;if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>1024*1024){setMessage("Choose a JPG, PNG or WebP image up to 1 MB.");return;}setBusy(true);try{const imageUrl=await onPhoto(file);setValue(current=>({...current,imageUrl}));setMessage(preview?"Photo saved on this device.":"Profile photo updated.");}catch{setMessage("The photo could not be saved.");}finally{setBusy(false);}}
  return <form className="settings-section personal-profile" onSubmit={event=>{event.preventDefault();void save();}}>
    <header className="personal-profile-heading"><span className="personal-profile-icon"><UserRound size={22}/></span><div><h2>Your profile</h2><p>Make your account recognisable to your colleagues.</p></div></header>
    {preview?<p className="personal-profile-demo">Demo profile · Changes are saved on this device only, not to a live account.</p>:null}
    <fieldset disabled={busy} className="personal-profile-fields">
      <div className="personal-profile-photo"><div className="personal-profile-avatar">{value.imageUrl?<Image unoptimized src={value.imageUrl} width={88} height={88} alt="Your profile photograph"/>:<span aria-label="Profile initials">{[value.firstName,value.lastName].map(name=>name.trim()[0]??"").join("").toUpperCase()||"U"}</span>}</div><div className="personal-profile-upload"><h3><Camera size={17}/> Profile photograph</h3><p>JPG, PNG or WebP, up to 1 MB. Your photo changes when you select a file.</p><label className="field"><span>Choose a profile photograph</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>void photo(event.target.files?.[0])}/></label></div></div>
      <div className="personal-profile-details"><h3>Personal details</h3><div className="form-grid"><label className="field"><span>First name</span><input required value={value.firstName} maxLength={100} autoComplete="given-name" onChange={event=>setValue({...value,firstName:event.target.value})}/></label><label className="field"><span>Last name</span><input value={value.lastName} maxLength={100} autoComplete="family-name" onChange={event=>setValue({...value,lastName:event.target.value})}/></label></div><p>Professional credentials belong in Professional details. Email and sign-in protection are managed in Security.</p></div>
    </fieldset>
    <div className="personal-profile-actions"><p role="status">{message}</p><button type="submit" className="button button-primary" disabled={busy||!value.firstName.trim()}>{busy?"Saving…":"Save profile"}</button></div>
  </form>;
}
export function LivePersonalProfile(){const {user,isLoaded}=useUser();const router=useRouter();if(!isLoaded)return <p>Loading your profile…</p>;if(!user)return <p>Sign in to manage your profile.</p>;return <ProfileForm key={user.id} initial={{firstName:user.firstName??"",lastName:user.lastName??"",imageUrl:user.imageUrl}} onSave={async value=>{await user.update({firstName:value.firstName.trim(),lastName:value.lastName.trim()});router.refresh();}} onPhoto={async file=>{await user.setProfileImage({file});await user.reload();router.refresh();return user.imageUrl;}}/>;}
export function PreviewPersonalProfile(){
  const [value,setValue]=useState<Profile|null>(null);
  useEffect(()=>{Promise.resolve().then(()=>{try{setValue(JSON.parse(localStorage.getItem("surveynt:preview-profile")??"null")??{firstName:"Maya",lastName:"Patel",imageUrl:""});}catch{setValue({firstName:"Maya",lastName:"Patel",imageUrl:""});}});},[]);
  if(!value)return <p>Loading demo profile…</p>;
  return <ProfileForm preview initial={value} onSave={async next=>{localStorage.setItem("surveynt:preview-profile",JSON.stringify(next));setValue(next);}} onPhoto={async file=>{const imageUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const next={...value,imageUrl};localStorage.setItem("surveynt:preview-profile",JSON.stringify(next));setValue(next);return imageUrl;}}/>;
}
